import type { TopicImport, TopicLambdaSubscription, TopicService } from '@ez4/topic/library';
import type { EmulateServiceContext, ServeOptions } from '@ez4/project/library';
import type { AnyObject } from '@ez4/utils';
import type { Topic } from '@ez4/topic';
import type { MessageTrace } from '@ez4/local-common';

import { createModule, onBegin, onReady, onDone, onError, onEnd } from '@ez4/local-common';
import { getRandomUUID, pickObject } from '@ez4/utils';
import { Runtime } from '@ez4/common';

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
