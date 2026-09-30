import type { Client, Queue, ReceiveOptions, SendOptions } from '@ez4/queue';
import type { QueueService } from '@ez4/queue/library';
import type { LocalQueueHandle } from '../utils/handle';
import type { LocalQueue } from '../service/queue';

import { captureMessageTrace } from '@ez4/local-common';
import { getJsonMessage } from '@ez4/queue/utils';
import { Logger } from '@ez4/logger';

import { getOutgoingMessage } from '../utils/message';
import { LocalQueueHandleKey } from '../utils/handle';

export const createLocalClient = <T extends Queue.Message = any, U extends Queue.Mode = any>(
  service: QueueService,
  queue: LocalQueue,
  handle: LocalQueueHandle
): Client<T, U> => {
  const { name: resourceName, schema } = service;

  return new (class {
    get [LocalQueueHandleKey]() {
      return handle;
    }

    async sendMessage(message: T, options?: SendOptions<U>) {
      // The trace is taken before anything else, callers import the scope right before sending.
      const trace = captureMessageTrace();

      Logger.log(`✉️  Sending message to queue [${resourceName}]`);

      const outgoingMessage = await getOutgoingMessage(message, service, trace, options?.delay);

      queue.sendMessage(outgoingMessage);
    }

    async receiveMessage(options?: ReceiveOptions): Promise<T[]> {
      const receivedMessages = await queue.pollMessages(options?.messages, options?.polling);

      // Like the real client, the messages aren't deleted and come back after the visibility timeout.
      return Promise.all(receivedMessages.map(({ body }) => getJsonMessage(JSON.parse(body), schema)));
    }
  })();
};
