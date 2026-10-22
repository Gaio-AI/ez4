import type { QueueImport, QueueService } from '@ez4/queue/library';
import type { Client, Queue, SendOptions } from '@ez4/queue';

import { getJsonStringMessage } from '@ez4/queue/utils';
import { Logger } from '@ez4/logger';

import { getMessageGroupId } from '../utils/group';
import { sendEachMessage } from '../utils/message';

export type ClientMockClient<T extends Queue.Message, U extends Queue.Mode> = Client<T, U> & {
  readonly delivered: T[];
};

export const createClientMock = <T extends Queue.Message = any, U extends Queue.Mode = any>(
  resourceName: string,
  contract?: QueueService | QueueImport
): ClientMockClient<T, U> => {
  const delivered: T[] = [];

  const deliverMessage = async (message: T) => {
    if (!contract) {
      return;
    }

    // The same checks the real client makes before sending, so a message it would refuse fails here too.
    const payload = await getJsonStringMessage(message, contract.schema);

    getMessageGroupId(message, contract);

    delivered.push(JSON.parse(payload));
  };

  return new (class {
    get delivered() {
      return delivered;
    }

    async sendMessage(message: T, _options?: SendOptions<U>) {
      Logger.log(`✉️  Sending message to queue [${resourceName}]`);

      await deliverMessage(message);
    }

    async sendMessages(messages: T[], _options?: SendOptions<U>) {
      Logger.log(`✉️  Sending ${messages.length} messages to queue [${resourceName}]`);

      await sendEachMessage(messages, deliverMessage);
    }

    receiveMessage(): Promise<T[]> {
      throw new Error(`Receive message isn't supported yet.`);
    }
  })();
};
