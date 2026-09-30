import type { WsService } from '@ez4/gateway/library';
import type { AnyObject } from '@ez4/utils';

import type {
  EmulateServiceContext,
  EmulatorConnectionEvent,
  EmulatorMessageEvent,
  EmulatorConnection,
  ServeOptions
} from '@ez4/project/library';

import { getServiceName } from '@ez4/project/library';
import { isAnyNumber, toSnakeCase } from '@ez4/utils';
import { HttpError } from '@ez4/gateway';
import { Logger } from '@ez4/logger';

import { createWsServiceClient } from '../../client/ws/service';
import { processWsAuthorization } from '../../handlers/ws/authorizer';
import { processWsConnection } from '../../handlers/ws/connection';
import { processWsMessage } from '../../handlers/ws/message';
import { getWsErrorResponse } from '../../utils/ws/response';

// API Gateway closes a connection 10 minutes after the last message from the client and 2 hours after it opens.
const IDLE_TIMEOUT = 600;
const CONNECTION_DURATION = 7200;

type ConnectionTimers = {
  idle?: NodeJS.Timeout;
  duration?: NodeJS.Timeout;
};

export const registerWsLocalService = (service: WsService, options: ServeOptions, context: EmulateServiceContext) => {
  const { name: resourceName, defaults, connect, message } = service;

  const { idleTimeout, connectionDuration } = getConnectionLimits(service, options);

  const allConnections: Record<string, EmulatorConnection> = {};
  const allTimers: Record<string, ConnectionTimers> = {};
  const identities: Record<string, AnyObject> = {};

  const clientOptions = {
    messageSchema: service.schema,
    preferences: message.preferences ?? defaults?.preferences,
    allConnections
  };

  // The close runs the disconnect handler as a client close does, and its failure can't escape the timer.
  const closeConnection = (connection: EmulatorConnection, reason: string) => {
    Logger.log(`🟥 Closing connection [${resourceName}] ${reason}`);

    Promise.resolve(connection.close()).catch((error) => {
      Logger.error(`Gateway [${resourceName}] ${error}`);
    });
  };

  const startIdleTimer = (connection: EmulatorConnection, timers: ConnectionTimers) => {
    clearTimeout(timers.idle);

    timers.idle = setTimeout(() => {
      closeConnection(connection, `after ${idleTimeout} seconds idle`);
    }, idleTimeout * 1000).unref();
  };

  return {
    type: 'Gateway',
    name: resourceName,
    identifier: getServiceName(resourceName, options),
    exportHandler: () => {
      return createWsServiceClient(resourceName, clientOptions);
    },
    connectHandler: async (event: EmulatorConnectionEvent) => {
      const { connection } = event;

      if (!connect.authorizer) {
        await processWsConnection(service, options, context, event);
      } else {
        const identity = await processWsAuthorization(service, options, context, event);

        if (identity) {
          await processWsConnection(service, options, context, event, identity);
          identities[connection.id] = identity;
        }
      }

      allConnections[connection.id] = connection;

      const timers: ConnectionTimers = {
        duration: setTimeout(() => {
          closeConnection(connection, `after ${connectionDuration} seconds open`);
        }, connectionDuration * 1000).unref()
      };

      startIdleTimer(connection, timers);

      allTimers[connection.id] = timers;
    },
    disconnectHandler: async (event: EmulatorConnectionEvent) => {
      const { connection } = event;

      const identity = identities[connection.id];
      const timers = allTimers[connection.id];

      clearTimeout(timers?.duration);
      clearTimeout(timers?.idle);

      delete allConnections[connection.id];
      delete allTimers[connection.id];

      return processWsConnection(service, options, context, event, identity);
    },
    messageHandler: async (message: EmulatorMessageEvent) => {
      const { connection } = message;

      const timers = allTimers[connection.id];

      if (timers) {
        startIdleTimer(connection, timers);
      }

      try {
        const identity = identities[connection.id];

        return await processWsMessage(service, options, context, message, identity);
        //
      } catch (error) {
        if (error instanceof HttpError) {
          return getWsErrorResponse(error);
        }

        throw error;
      }
    }
  };
};

// A local session can change both limits (in seconds) in the options of the service, as the database emulators read theirs.
const getConnectionLimits = (service: WsService, options: ServeOptions) => {
  const optionsName = toSnakeCase(service.name);

  const { idleTimeout, connectionDuration } = {
    ...options.localOptions[optionsName],
    ...(options.test && options.testOptions[optionsName])
  };

  return {
    idleTimeout: isAnyNumber(idleTimeout) ? idleTimeout : IDLE_TIMEOUT,
    connectionDuration: isAnyNumber(connectionDuration) ? connectionDuration : CONNECTION_DURATION
  };
};
