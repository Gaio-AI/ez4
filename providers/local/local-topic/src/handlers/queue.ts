import type { TopicQueueSubscription } from '@ez4/topic/library';
import type { EmulateServiceContext } from '@ez4/project/library';
import type { MessageTrace } from '@ez4/local-common';
import type { Client as QueueClient } from '@ez4/queue';
import type { AnyObject } from '@ez4/utils';

import { getRandomUUID } from '@ez4/utils';
import { Runtime } from '@ez4/common';
import { Logger } from '@ez4/logger';

export const processQueueEvent = async (
  context: EmulateServiceContext,
  subscription: TopicQueueSubscription,
  event: AnyObject,
  trace: MessageTrace
) => {
  try {
    const queueClient = context.makeClient(subscription.service) as QueueClient<any, any>;

    // The queue client captures the runtime scope synchronously, so it must be imported right before sendMessage.
    Runtime.importScope(trace.traceId ?? getRandomUUID(), trace.scope);

    await queueClient.sendMessage(event);
    //
  } catch (error) {
    Logger.error(`${error}`);
  }
};
