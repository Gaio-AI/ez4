import type { CommonOptions } from '@ez4/project/library';
import type { EventSchema } from '@ez4/topic/utils';
import type { Client, Topic } from '@ez4/topic';

import { getJsonStringEvent } from '@ez4/topic/utils';
import { getServiceName } from '@ez4/project/library';
import { captureMessageTrace, getMessageTraceHeaders } from '@ez4/local-common';
import { Logger } from '@ez4/logger';

import { getTopicServiceHost, sendTopicServiceRequest, subscribeToTopicService, unsubscribeFromTopicService } from '../utils/topic';

export type RemoteClientOptions = CommonOptions & {
  serviceHost: string;
};

export type RemoteSubscription = {
  stop: () => Promise<void>;
};

const enum SubscriptionState {
  Pending = 'pending',
  Subscribed = 'subscribed',
  Lost = 'lost'
}

// The owner keeps subscriptions by resource name, so renewing one is idempotent and brings it back after the owner restarts.
const SUBSCRIPTION_RENEWAL_DELAY = 15000;

const SUBSCRIPTION_FIRST_RETRY_DELAY = 1000;
const SUBSCRIPTION_MAX_RETRY_DELAY = 10000;

export const createRemoteClient = <T extends Topic.Event = any>(
  resourceName: string,
  eventSchema: EventSchema,
  clientOptions: RemoteClientOptions
): Client<T> => {
  const topicIdentifier = getServiceName(resourceName, clientOptions);
  const topicHost = getTopicServiceHost(clientOptions.serviceHost, topicIdentifier);

  return new (class {
    async publishEvent(event: T) {
      const trace = captureMessageTrace();

      Logger.log(`✉️  Publishing event to topic [${resourceName}] at ${topicHost}.`);

      const payload = await getJsonStringEvent(event, eventSchema);

      setImmediate(async () => {
        try {
          await sendTopicServiceRequest(topicHost, payload, getMessageTraceHeaders(trace));
        } catch (error) {
          Logger.error(`Remote topic [${resourceName}] at ${topicHost} isn't available.`);
          Logger.error(`    ${error}`);
        }
      });
    }
  })();
};

export const unsubscribeRemoteClient = async (resourceName: string, remoteHost: string, clientOptions: RemoteClientOptions) => {
  const topicIdentifier = getServiceName(resourceName, clientOptions);
  const topicHost = getTopicServiceHost(clientOptions.serviceHost, topicIdentifier);

  try {
    await unsubscribeFromTopicService(topicHost, {
      serviceHost: remoteHost,
      resourceName
    });

    Logger.log(`⛔ Unsubscribed from topic [${resourceName}] at ${topicHost}`);
    //
  } catch {
    // Suppress unsubscription errors.
  }
};

// Projects start together and restart on their own, so the subscription is retried until the owner
// answers and renewed while it's running.
export const subscribeRemoteClient = async (
  resourceName: string,
  remoteHost: string,
  clientOptions: RemoteClientOptions
): Promise<RemoteSubscription> => {
  const topicIdentifier = getServiceName(resourceName, clientOptions);
  const topicHost = getTopicServiceHost(clientOptions.serviceHost, topicIdentifier);

  let state = SubscriptionState.Pending;
  let failures = 0;

  let timer: NodeJS.Timeout | undefined;
  let isStopped = false;

  const subscribe = async () => {
    try {
      await subscribeToTopicService(topicHost, {
        serviceHost: remoteHost,
        resourceName
      });

      if (state === SubscriptionState.Pending) {
        Logger.log(`✉️  Subscribed to topic [${resourceName}] at ${topicHost}`);
      }

      if (state === SubscriptionState.Lost) {
        Logger.log(`✉️  Subscribed again to topic [${resourceName}] at ${topicHost}`);
      }

      state = SubscriptionState.Subscribed;
      failures = 0;
      //
    } catch {
      if (state === SubscriptionState.Subscribed) {
        Logger.warn(`Subscription to topic [${resourceName}] at ${topicHost} was lost.`);

        state = SubscriptionState.Lost;
      }

      if (state === SubscriptionState.Pending && !failures) {
        Logger.warn(`Remote topic [${resourceName}] at ${topicHost} isn't available.`);
      }

      failures++;
    }
  };

  let request = subscribe();

  const scheduleSubscription = () => {
    if (isStopped) {
      return;
    }

    const delay =
      state === SubscriptionState.Subscribed
        ? SUBSCRIPTION_RENEWAL_DELAY
        : Math.min(SUBSCRIPTION_FIRST_RETRY_DELAY * 2 ** (failures - 1), SUBSCRIPTION_MAX_RETRY_DELAY);

    timer = setTimeout(async () => {
      request = subscribe();

      await request;

      scheduleSubscription();
    }, delay);
  };

  await request;

  scheduleSubscription();

  return {
    stop: async () => {
      isStopped = true;

      clearTimeout(timer);

      // A subscription still on its way must not reach the owner after the unsubscription.
      await request;
    }
  };
};
