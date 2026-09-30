import type { DatabaseService } from '@ez4/database/library';
import type { ServeOptions } from '@ez4/project/library';
import type { ClientConnection, ClientDataApiOptions } from '@ez4/pgclient';

import { isAnyObject, isEmptyObject, toSnakeCase } from '@ez4/utils';
import { getDatabaseName } from '@ez4/pgclient/utils';

import { ConnectionMode } from '../client/types';
import { LocalOptionsNotFoundError } from './errors';

export const getConnectionOptions = (service: DatabaseService, options: ServeOptions): ClientConnection => {
  const optionsName = toSnakeCase(service.name);

  const serviceOptions = {
    ...options.localOptions[optionsName],
    ...(options.test && options.testOptions[optionsName])
  };

  if (isEmptyObject(serviceOptions)) {
    throw new LocalOptionsNotFoundError(optionsName, service.name);
  }

  const { user, password, host, port, database, poolSize, dataApi } = serviceOptions;

  return {
    database: database ?? getDatabaseName(service, options),
    host: host ?? 'localhost',
    password,
    user,
    port,
    poolSize,
    dataApi: getDataApiOptions(service, dataApi)
  };
};

export const getMigrationConnectionOptions = (service: DatabaseService, options: ServeOptions): ClientConnection => {
  const connection = getConnectionOptions(service, options);

  const { dataApi } = connection;

  // Deployed migrations ask the Data API to continue after its timeout, so local migrations run without one.
  return {
    ...connection,
    dataApi: dataApi && {
      ...(isAnyObject(dataApi) && dataApi),
      statementTimeout: 0
    }
  };
};

// Opt-in through `localOptions.<service>.dataApi` (`true` or its options), and only for a service that talks to the
// Data API in production.
const getDataApiOptions = (service: DatabaseService, dataApi: unknown): ClientDataApiOptions | undefined => {
  const { connectionMode = ConnectionMode.Api } = service.options ?? {};

  if (!dataApi || connectionMode !== ConnectionMode.Api) {
    return undefined;
  }

  return isAnyObject(dataApi) ? dataApi : {};
};
