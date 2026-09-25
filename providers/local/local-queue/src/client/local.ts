import type { Client, Queue, SendOptions } from '@ez4/queue';
import type { ServeOptions } from '@ez4/project/library';
import type { MessageSchema } from '@ez4/queue/utils';
import type { AnyObject } from '@ez4/utils';
import type { MessageTrace } from '@ez4/local-common';

import { setTimeout } from 'node:timers/promises';

import { getJsonMessage } from '@ez4/queue/utils';
import { captureMessageTrace } from '@ez4/local-common';
import { Logger } from '@ez4/logger';

export type LocalClientOptions = ServeOptions & {
  handler: (message: AnyObject, trace: MessageTrace) => Promise<void>;
  delay: number;
};

export const createLocalClient = <T extends Queue.Message = any, U extends Queue.Mode = any>(
  resourceName: string,
  messageSchema: MessageSchema,
  clientOptions: LocalClientOptions
): Client<T, U> => {
  return new (class {
    async sendMessage(message: T, options?: SendOptions<U>) {
      const trace = captureMessageTrace();

      Logger.log(`✉️  Sending message to queue [${resourceName}]`);

      const payload = await getJsonMessage(message, messageSchema);
      const delay = options?.delay ?? clientOptions.delay;

      setImmediate(async () => {
        try {
          await setTimeout(delay * 1000);
          await clientOptions.handler(payload, trace);
        } catch (error) {
          Logger.error(`Local queue [${resourceName}] finished with errors.`);
          Logger.error(`    ${error}`);
        }
      });
    }

    receiveMessage(): Promise<T[]> {
      throw new Error(`Receive message isn't supported yet.`);
    }
  })();
};
