import type { TopicImport, TopicService } from '@ez4/topic/library';
import type { Client, Topic } from '@ez4/topic';

import { getJsonStringEvent } from '@ez4/topic/utils';
import { Logger } from '@ez4/logger';

export type ClientMockClient<T extends Topic.Event> = Client<T> & {
  readonly delivered: T[];
};

export const createClientMock = <T extends Topic.Event = any>(
  resourceName: string,
  contract?: TopicService | TopicImport
): ClientMockClient<T> => {
  const delivered: T[] = [];

  return new (class {
    get delivered() {
      return delivered;
    }

    async publishEvent(event: T) {
      Logger.log(`✉️  Publishing event to topic [${resourceName}]`);

      if (!contract) {
        return;
      }

      // The same validation the real client makes before publishing, so an event it would refuse fails here too.
      const payload = await getJsonStringEvent(event, contract.schema);

      delivered.push(JSON.parse(payload));
    }
  })();
};
