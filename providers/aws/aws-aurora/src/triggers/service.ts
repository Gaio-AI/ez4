import type { PrepareResourceEvent, ServiceEvent } from '@ez4/project/library';

import { getDatabaseName } from '@ez4/pgclient/utils';
import { getTableRepository } from '@ez4/pgclient/library';
import { validateRepository } from '@ez4/pgmigration';
import { PaginationMode } from '@ez4/database';

import { createCluster } from '../cluster/service';
import { createInstance } from '../instance/service';
import { createMigration } from '../migration/service';
import { createIntegrity } from '../integrity/service';
import { getClusterName, getInstanceName, isAuroraService, isLinkedWithIam } from './utils';
import { UnsupportedPaginationModeError } from './errors';
import { prepareLinkedClient } from './client';

export const prepareLinkedServices = (event: ServiceEvent) => {
  const { service, options, context } = event;

  if (isAuroraService(service)) {
    return prepareLinkedClient(context, service, options);
  }

  return null;
};

export const prepareDatabaseServices = (event: PrepareResourceEvent) => {
  const { state, service, metadata, options, context } = event;

  if (!isAuroraService(service)) {
    return false;
  }

  const { engine, scalability } = service;

  if (engine.paginationMode === PaginationMode.Cursor) {
    throw new UnsupportedPaginationModeError(engine.paginationMode);
  }

  const repository = getTableRepository(service.tables);

  validateRepository(repository);

  const clusterState = createCluster(state, {
    clusterName: getClusterName(service, options),
    branchMode: !!options.branchName,
    tags: options.tags,
    enableInsights: true,
    enableHttp: true,
    scalability,
    // Only when needed: a parameter the cluster didn't have would update every existing cluster.
    ...(isLinkedWithIam(service, metadata) && {
      enableIamAuth: true
    })
  });

  const instanceState = createInstance(state, clusterState, {
    instanceName: getInstanceName(service, options),
    branchMode: !!options.branchName,
    tags: options.tags
  });

  const { migration = true } = service.options ?? {};

  const migrationState = createMigration(state, clusterState, instanceState, {
    repository,
    database: getDatabaseName(service, options),
    ...(!migration && { disabled: true })
  });

  const integrityState = createIntegrity(state, migrationState);
  const integrityName = getDatabaseName(service, options);

  context.setServiceState(integrityName, options, integrityState);
  context.setServiceState(service, options, clusterState);

  return true;
};
