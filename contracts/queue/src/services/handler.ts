import type { Service } from '@ez4/common';
import type { QueueIncoming } from './incoming';
import type { QueueMessage } from './message';
import type { Queue } from './contract';

/**
 * Queue subscription handler, which receives the given request type.
 */
export type QueueSubscriptionHandler<T extends QueueMessage, R extends QueueIncoming<T> = QueueIncoming<T>> = (
  request: R,
  context: Service.Context<Queue.Service<any, any> | Queue.Import<any>>
) => Promise<void> | void;
