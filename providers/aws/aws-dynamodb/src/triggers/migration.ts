import type { EmulateServiceEvent } from '@ez4/project/library';

import { getServiceName } from '@ez4/project/library';

import { getConnectionOptions } from '../local/options';
import { syncAllTables, deleteAllTables } from '../local/tables';
import { runServiceTask, startLocalWorkers, stopLocalWorkers } from '../local/workers';
import { getClientInstance } from '../client/utils/instance';
import { isDynamoDbService } from './utils';

export const prepareEmulatorStart = async (event: EmulateServiceEvent) => {
  const { service, options, context } = event;

  if (!isDynamoDbService(service) || !options.local) {
    return;
  }

  const serviceName = getServiceName(service, options);

  await runServiceTask(serviceName, async () => {
    await stopLocalWorkers(serviceName);

    const connection = getConnectionOptions(service, options);
    const client = getClientInstance(connection);

    await syncAllTables(client, service, options);

    // Like the scheduler timers, stream handlers and TTL sweepers are background emulation that `test`,
    // `run` and `serve --suppress` turn off, so no handler runs on the changes of other tests.
    if (!options.suppress) {
      await startLocalWorkers(service, options, context);
    }
  });
};

export const prepareEmulatorStop = async (event: EmulateServiceEvent) => {
  const { service, options } = event;

  if (isDynamoDbService(service)) {
    const serviceName = getServiceName(service, options);

    await runServiceTask(serviceName, () => stopLocalWorkers(serviceName));
  }
};

export const prepareEmulatorReset = async (event: EmulateServiceEvent) => {
  const { service, options } = event;

  if (!isDynamoDbService(service) || !options.local) {
    return;
  }

  const serviceName = getServiceName(service, options);

  await runServiceTask(serviceName, async () => {
    await stopLocalWorkers(serviceName);

    const connection = getConnectionOptions(service, options);
    const client = getClientInstance(connection);

    await deleteAllTables(client, service, options);
  });
};
