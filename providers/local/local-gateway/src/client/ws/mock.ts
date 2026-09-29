import type { WsService } from '@ez4/gateway/library';
import type { Ws, WsClient } from '@ez4/gateway';

import { resolveResponseBody } from '@ez4/gateway/utils';
import { Logger } from '@ez4/logger';

export type WsClientMockDelivery<T extends Ws.JsonBody> = {
  connectionId: string;
  message: T;
};

export type WsClientMockClient<T extends Ws.JsonBody> = WsClient<T> & {
  readonly delivered: WsClientMockDelivery<T>[];
};

export const createWsClientMock = <T extends Ws.JsonBody>(resourceName: string, contract?: WsService): WsClientMockClient<T> => {
  const delivered: WsClientMockDelivery<T>[] = [];

  return new (class {
    get delivered() {
      return delivered;
    }

    sendMessage<T extends Ws.JsonBody>(connectionId: string, message: T) {
      Logger.log(`✉️  Sending message to connection [${resourceName}]`);

      if (contract) {
        const preferences = contract.message.preferences ?? contract.defaults?.preferences;

        // What the connection receives: the message serialized by the service schema, as the real client sends it.
        const payload = JSON.stringify(resolveResponseBody(message, contract.schema, preferences));

        delivered.push({
          message: JSON.parse(payload),
          connectionId
        });
      }

      return Promise.resolve();
    }

    disconnect(_connectionId: string) {
      Logger.log(`🟥 Closing connection [${resourceName}]`);
      return Promise.resolve();
    }
  })();
};
