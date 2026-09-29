import type { TopicImport, TopicLambdaSubscription, TopicService } from '@ez4/topic/library';
import type { EmulateServiceContext, ServeOptions } from '@ez4/project/library';
import type { AnyObject } from '@ez4/utils';
import type { Topic } from '@ez4/topic';
import type { MessageTrace } from '@ez4/local-common';

import { createModule, onBegin, onReady, onDone, onError, onEnd } from '@ez4/local-common';
import { getRandomUUID, pickObject } from '@ez4/utils';
import { Runtime } from '@ez4/common';
import { Logger } from '@ez4/logger';

// SNS invokes the Lambda asynchronously, and AWS retries a failed asynchronous invocation twice.
const RETRY_DELAYS = [1000, 2000];

export const processLambdaSubscription = async (
  service: TopicService | TopicImport,
  options: ServeOptions,
  context: EmulateServiceContext,
  subscription: TopicLambdaSubscription,
  event: AnyObject,
  trace: MessageTrace,
  attempt = 0
) => {
  try {
    await processLambdaEvent(service, options, context, subscription, event, trace);
    //
  } catch {
    const delay = RETRY_DELAYS[attempt];
    const label = `Topic [${service.name}] subscription ${subscription.handler.name}`;

    if (delay === undefined) {
      return Logger.error(`${label} failed after ${attempt + 1} attempts and was dropped.`);
    }

    Logger.warn(`${label} failed, retry ${attempt + 1} of ${RETRY_DELAYS.length} in ${delay / 1000}s.`);

    setTimeout(() => processLambdaSubscription(service, options, context, subscription, event, trace, attempt + 1), delay);
  }
};

export const processLambdaEvent = async (
  service: TopicService | TopicImport,
  options: ServeOptions,
  context: EmulateServiceContext,
  subscription: TopicLambdaSubscription,
  event: AnyObject,
  trace: MessageTrace
) => {
  const { services } = service;

  const servicesInUse = subscription.handler.references ? pickObject(services, subscription.handler.references) : services;
  const serviceClients = context.makeClients(servicesInUse);

  const traceId = trace.traceId ?? getRandomUUID();

  const module = await createModule({
    listener: subscription.listener,
    handler: subscription.handler,
    version: options.version,
    variables: {
      ...options.variables,
      ...service.variables,
      ...subscription.variables
    }
  });

  let currentRequest: Topic.Incoming<Topic.Event> | undefined;

  const request = {
    requestId: getRandomUUID()
  };

  try {
    await onBegin(module, serviceClients, request);

    currentRequest = {
      ...request,
      event,
      traceId
    };

    Runtime.importScope(traceId, trace.scope);

    await onReady(module, serviceClients, currentRequest);
    await module.handler(currentRequest, serviceClients);
    await onDone(module, serviceClients, currentRequest);
    //
  } catch (error) {
    await onError(module, serviceClients, currentRequest ?? request, error);

    throw error;
    //
  } finally {
    await onEnd(module, serviceClients, request);
  }
};
