import type { EmulateServiceContext, EmulatorRequestEvent, ServeOptions } from '@ez4/project/library';
import type { QueueService, QueueSubscription } from '@ez4/queue/library';
import type { LocalQueueHandle } from '../utils/handle';
import type { LocalQueue } from '../service/queue';
import type { QueuePoller } from '../service/poller';

import { getErrorResponse, getMessageTraceFromHeaders, getSuccessResponse } from '@ez4/local-common';
import { MalformedMessageError, MissingMessageGroupError } from '@ez4/queue/utils';
import { getServiceName } from '@ez4/project/library';

import { processLambdaBatch } from '../handlers/lambda';
import { createLocalClient } from '../client/local';
import { createLocalQueue } from '../service/queue';
import { startQueuePoller } from '../service/poller';
import { QueueManifest } from '../service/manifest';
import { getMessageDelayFromHeaders, getOutgoingMessage } from '../utils/message';
import { InvalidParameterValueError } from '../utils/errors';
import { Defaults } from '../utils/defaults';

export const registerLocalService = (service: QueueService, options: ServeOptions, context: EmulateServiceContext) => {
  const { name: resourceName } = service;

  // A reload registers the service again with a queue of its own, and the messages waiting or in flight in
  // the previous queue are dropped with it.
  const queue = createLocalQueue(getQueueParameters(service));

  let pollers: QueuePoller[] = [];

  const handle: LocalQueueHandle = {
    getDeadLetterMessages: () => {
      return queue.getDeadLetterMessages().map(({ body }) => JSON.parse(body));
    },
    waitForDrain: () => {
      return queue.waitUntil(() => queue.isEmpty() && pollers.every((poller) => poller.isIdle()));
    }
  };

  return {
    type: 'Queue',
    name: resourceName,
    identifier: getServiceName(resourceName, options),
    exportHandler: () => {
      return createLocalClient(service, queue, handle);
    },
    requestHandler: (request: EmulatorRequestEvent) => {
      return handleQueueRequest(service, queue, request);
    },
    manifestHandler: () => {
      return QueueManifest.build(service);
    },
    bootstrapHandler: () => {
      pollers = service.subscriptions.map((subscription) => {
        return startSubscriptionPoller(service, options, context, subscription, queue);
      });
    },
    shutdownHandler: () => {
      pollers.forEach((poller) => poller.stop());
      pollers = [];

      queue.shutdown();
    }
  };
};

const getQueueParameters = (service: QueueService) => {
  const { name, fifoMode, deadLetter, timeout, retention, delay, polling } = service;

  return {
    queueName: name,
    fifoMode: !!fifoMode,
    visibilityTimeout: timeout ?? Defaults.Timeout,
    retention: retention ?? Defaults.Retention,
    delay: delay ?? Defaults.Delay,
    polling: polling ?? 0,
    ...(deadLetter && {
      deadLetter: {
        maxAttempts: deadLetter.maxAttempts,
        retention: deadLetter.retention ?? Defaults.Retention
      }
    })
  };
};

const startSubscriptionPoller = (
  service: QueueService,
  options: ServeOptions,
  context: EmulateServiceContext,
  subscription: QueueSubscription,
  queue: LocalQueue
) => {
  const { batch = Defaults.Batch, concurrency } = subscription;

  return startQueuePoller(queue, {
    batchSize: batch,
    batchWindow: service.fifoMode ? 0 : Math.min(Math.round(batch / 21), 10),
    concurrency,
    processBatch: (messages, signal) => {
      return processLambdaBatch(service, options, context, subscription, queue, messages, signal);
    }
  });
};

const handleQueueRequest = async (service: QueueService, queue: LocalQueue, request: EmulatorRequestEvent) => {
  const { method, path, body, headers } = request;

  if (method !== 'POST' || path !== '/' || !body) {
    throw new Error('Unsupported queue request.');
  }

  try {
    const jsonMessage = JSON.parse(body.toString());

    const trace = getMessageTraceFromHeaders(headers);
    const delay = getMessageDelayFromHeaders(headers);

    queue.sendMessage(await getOutgoingMessage(jsonMessage, service, trace, delay));

    return getSuccessResponse(201);
    //
  } catch (error) {
    if (error instanceof MalformedMessageError) {
      return getErrorResponse(400, {
        message: error.message,
        context: error.context
      });
    }

    if (error instanceof MissingMessageGroupError || error instanceof InvalidParameterValueError) {
      return getErrorResponse(400, {
        message: error.message
      });
    }

    throw error;
  }
};
