import type { EmulateServiceContext, ServeOptions } from '@ez4/project/library';
import type { AgentService } from '@ez4/agent/library';
import { getServiceName } from '@ez4/project/library';
import { createAgentStubClient } from '../client/stub';

export const registerLocalService = (service: AgentService, options: ServeOptions, _context: EmulateServiceContext) => {
  const resourceName = service.name;

  return {
    type: 'Agent',
    name: resourceName,
    identifier: getServiceName(resourceName, options),
    exportHandler: () => {
      return createAgentStubClient(resourceName);
    }
  };
};
