import type { EmulateServiceContext, EmulatorRequestEvent, ServeOptions } from '@ez4/project/library';
import type { QueueImport, QueueService } from '@ez4/queue/library';
import type { AnyObject } from '@ez4/utils';
import type { MessageTrace } from '@ez4/local-common';

import { getErrorResponse, getMessageTraceFromHeaders, getSuccessResponse } from '@ez4/local-common';
import { MalformedMessageError } from '@ez4/queue/utils';
import { getServiceName } from '@ez4/project/library';
import { getRandomInteger } from '@ez4/utils';

import { processLambdaMessage } from '../handlers/lambda';
import { createLocalClient } from '../client/local';
import { QueueManifest } from '../service/manifest';

export const registerLocalService = (service: QueueService, options: ServeOptions, context: EmulateServiceContext) => {
  const { name: resourceName, schema: messageSchema } = service;

  const clientOptions = {
    ...options,
    delay: service.delay ?? 0,
    handler: (message: AnyObject, trace: MessageTrace) => {
      return handleQueueMessage(service, options, context, message, trace);
    }
  };

  return {
    type: 'Queue',
    name: resourceName,
    identifier: getServiceName(resourceName, options),
    exportHandler: () => {
      return createLocalClient(resourceName, messageSchema, clientOptions);
    },
    requestHandler: (request: EmulatorRequestEvent) => {
      return handleQueueRequest(service, options, context, request);
    },
    manifestHandler: () => {
      return QueueManifest.build(service);
    }
  };
};

const handleQueueRequest = async (
  service: QueueService,
  options: ServeOptions,
  context: EmulateServiceContext,
  request: EmulatorRequestEvent
) => {
  const { method, path, body, headers } = request;

  if (method !== 'POST' || path !== '/' || !body) {
    throw new Error('Unsupported queue request.');
  }

  try {
    const jsonMessage = JSON.parse(body.toString());

    await handleQueueMessage(service, options, context, jsonMessage, getMessageTraceFromHeaders(headers));

    return getSuccessResponse(201);
    //
  } catch (error) {
    if (!(error instanceof MalformedMessageError)) {
      throw error;
    }

    return getErrorResponse(400, {
      message: error.message,
      context: error.context
    });
  }
};

const handleQueueMessage = async (
  service: QueueService | QueueImport,
  options: ServeOptions,
  context: EmulateServiceContext,
  message: AnyObject,
  trace: MessageTrace
) => {
  const subscriptionIndex = getRandomInteger(0, service.subscriptions.length - 1);
  const queueSubscription = service.subscriptions[subscriptionIndex];

  if (queueSubscription) {
    await processLambdaMessage(service, options, context, queueSubscription, message, trace, (delay) => {
      setTimeout(() => handleQueueMessage(service, options, context, message, trace), 1000 * delay);
    });
  }
};
