import type { EmulateServiceContext, ServeOptions } from '@ez4/project/library';
import type { HttpImport } from '@ez4/gateway/library';

import { getServiceName, MissingImportedProjectError } from '@ez4/project/library';
import { getClientAuthorization, getClientOperations } from '@ez4/gateway/library';

import { createHttpServiceClient } from '../../client/http/service';

export const registerHttpRemoteService = (service: HttpImport, options: ServeOptions, _context: EmulateServiceContext) => {
  const { name: resourceName, reference: referenceName, displayName, project } = service;
  const { imports } = options;

  if (!imports || !imports[project]) {
    throw new MissingImportedProjectError(project);
  }

  const clientOptions = {
    authorization: getClientAuthorization(service),
    operations: getClientOperations(service),
    ...imports[project]
  };

  return {
    type: 'Gateway',
    name: resourceName,
    identifier: getServiceName(resourceName, options),
    exportHandler: () => {
      // As the deploy does, the API is found by its name when it has one, and by the referenced class otherwise.
      return createHttpServiceClient(displayName ?? referenceName, clientOptions);
    }
  };
};
