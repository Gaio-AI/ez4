import type { PrepareResourceEvent, ServiceEvent } from '@ez4/project/library';

import { getServiceName, MissingImportedProjectError } from '@ez4/project/library';
import { isHttpImport } from '@ez4/gateway/library';
import { Logger } from '@ez4/logger';

import { createGateway } from '../../gateway/service';
import { GatewayProtocol } from '../../gateway/types';
import { prepareDisabledClient, prepareLinkedClient } from './client';

export const prepareHttpLinkedImport = (event: ServiceEvent) => {
  const { service, options, context } = event;
  const { imports } = options;

  if (isHttpImport(service)) {
    const { project } = service;

    if (!imports || !imports[project]) {
      throw new MissingImportedProjectError(project);
    }

    if (imports[project].disabled) {
      return prepareDisabledClient(service);
    }

    return prepareLinkedClient(context, service, options);
  }

  return null;
};

export const prepareHttpImports = (event: PrepareResourceEvent) => {
  const { state, service, options, context } = event;
  const { imports } = options;

  if (isHttpImport(service)) {
    const { project } = service;

    if (!imports || !imports[project]) {
      throw new MissingImportedProjectError(project);
    }

    const { name, reference, displayName, description } = service;

    // Said while preparing, so the plan doesn't read the missing gateway as drift.
    if (imports[project].disabled) {
      Logger.warn(`Import ${project} is disabled: ${name} isn't looked up and its client fails with 503.`);
      return true;
    }

    const gatewayState = createGateway(state, {
      gatewayId: getServiceName(service, options),
      gatewayName: displayName ?? reference,
      protocol: GatewayProtocol.Http,
      description,
      import: true
    });

    context.setServiceState(service, options, gatewayState);

    return true;
  }

  return false;
};
