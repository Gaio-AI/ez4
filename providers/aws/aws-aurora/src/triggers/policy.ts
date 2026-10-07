import type { DatabaseService } from '@ez4/database/library';
import type { DeployOptions, MetadataReflection, PolicyResourceEvent } from '@ez4/project/library';

import { ServiceType } from '@ez4/database/library';
import { createPolicy, tryGetPolicy } from '@ez4/aws-identity';
import { getServiceName } from '@ez4/project/library';

import { ConnectionMode } from '../client/types';
import { getPolicyDocument } from '../utils/policy';
import { getClusterName, isAuroraService } from './utils';

export const prepareExecutionPolicy = async (event: PolicyResourceEvent) => {
  const { state, metadata, serviceType, options } = event;

  if (serviceType !== ServiceType) {
    return null;
  }

  const policyPrefix = getServiceName('', options);
  const policyName = `${policyPrefix}-aurora-policy`;

  const resourcePrefix = getServiceName('', {
    disableBranch: true,
    ...options
  });

  return (
    tryGetPolicy(state, policyName) ??
    createPolicy(state, {
      tags: options.tags,
      policyDocument: await getPolicyDocument(resourcePrefix, getNativeClusterNames(metadata, options)),
      policyName
    })
  );
};

// Only a native connection signs in with IAM, so only the clusters some service links natively are looked up
// for the grant: a project on the Data API makes no extra call and needs no extra deploy permission.
const getNativeClusterNames = (metadata: MetadataReflection, options: DeployOptions) => {
  const allServices = Object.values(metadata);

  const isLinkedNatively = (database: DatabaseService) => {
    return allServices.some(({ services = {} }) => {
      return Object.values(services).some(({ reference, options: linkOptions }) => {
        const { connectionMode } = { ...database.options, ...linkOptions };

        return reference === database.name && connectionMode === ConnectionMode.Native;
      });
    });
  };

  return allServices
    .filter(isAuroraService)
    .filter(isLinkedNatively)
    .map((database) => getClusterName(database, options));
};
