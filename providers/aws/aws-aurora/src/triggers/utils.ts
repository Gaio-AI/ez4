import type { DatabaseService } from '@ez4/database/library';
import type { CommonOptions, LinkedOptions, MetadataReflection, ServiceMetadata } from '@ez4/project/library';

import { isDatabaseService } from '@ez4/database/library';
import { getServiceName } from '@ez4/project/library';

import { ConnectionMode } from '../client/types';

// The options of every link to the database: its own options, overridden by the link's
// (`Environment.Service<Db, { ... }>`).
const getDatabaseLinks = (database: DatabaseService, metadata: MetadataReflection): LinkedOptions[] => {
  return Object.values(metadata).flatMap(({ services = {} }) => {
    return Object.values(services)
      .filter(({ reference }) => reference === database.name)
      .map(({ options }) => ({ ...database.options, ...options }));
  });
};

const isNativeLink = ({ connectionMode }: LinkedOptions) => {
  return connectionMode === ConnectionMode.Native;
};

export const isLinkedNatively = (database: DatabaseService, metadata: MetadataReflection) => {
  return getDatabaseLinks(database, metadata).some(isNativeLink);
};

// A native link with a user signs in with IAM.
export const isLinkedWithIam = (database: DatabaseService, metadata: MetadataReflection) => {
  return getDatabaseLinks(database, metadata).some((link) => isNativeLink(link) && typeof link.user === 'string');
};

export const getClusterName = (service: DatabaseService, options: CommonOptions) => {
  return getServiceName(service, {
    disableBranch: true,
    ...options
  });
};

export const getInstanceName = (service: DatabaseService, options: CommonOptions) => {
  return `${getClusterName(service, options)}-instance`;
};

export const isAuroraService = (service: ServiceMetadata): service is DatabaseService => {
  return isDatabaseService(service) && service.engine.name === 'aurora';
};
