import type { EmulatorConnection } from '@ez4/project/library';
import type { WsPreferences } from '@ez4/gateway/library';
import type { Ws, WsClient } from '@ez4/gateway';
import type { AnySchema } from '@ez4/schema';

import { resolveResponseBody } from '@ez4/gateway/utils';
import { Logger } from '@ez4/logger';

export type WsServiceClientOptions = {
  preferences?: WsPreferences;
  allConnections: Record<string, EmulatorConnection>;
  messageSchema: AnySchema;
};

export const createWsServiceClient = <T extends Ws.JsonBody = any>(resourceName: string, options: WsServiceClientOptions): WsClient<T> => {
  const { allConnections, messageSchema, preferences } = options;

  return new (class {
    async sendMessage<T extends Ws.JsonBody>(connectionId: string, message: T) {
      const content = await resolveResponseBody(message, messageSchema, preferences);
      const connection = allConnections[connectionId];

      // The AWS client ignores the `GoneException` of a connection that no longer exists.
      if (!connection?.live) {
        Logger.debug(`✉️  Connection [${connectionId}] is gone [${resourceName}]`);
        return;
      }

      Logger.log(`✉️  Sending message to connection [${resourceName}]`);

      const payload = JSON.stringify(content);

      connection.write(payload);

      return Promise.resolve();
    }

    disconnect(connectionId: string) {
      const connection = allConnections[connectionId];

      Logger.log(`🟥 Closing connection [${resourceName}]`);

      if (connection) {
        connection.close();
      }

      return Promise.resolve();
    }
  })();
};
