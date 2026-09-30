import type { EmulateServiceContext, EmulatorRequestEvent, ServeOptions } from '@ez4/project/library';
import type { CdnService } from '@ez4/distribution/library';

import { getServiceName } from '@ez4/project/library';

import { processDistributionRequest } from '../handlers/request';

export const registerLocalService = (service: CdnService, options: ServeOptions, context: EmulateServiceContext) => {
  const { name: resourceName } = service;

  return {
    type: 'Distribution',
    name: resourceName,
    identifier: getServiceName(resourceName, options),
    requestHandler: (request: EmulatorRequestEvent) => {
      return processDistributionRequest(service, options, context, request);
    }
  };
};
