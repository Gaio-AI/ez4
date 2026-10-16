import type { EmulateServiceEvent } from '@ez4/project/library';
import { isAgentService, isAgentWorkflowService, registerTriggers as registerAgentTriggers } from '@ez4/agent/library';
import { tryCreateTrigger } from '@ez4/project/library';
import { registerLocalService, registerLocalWorkflowService } from './local';

export const registerTriggers = () => {
  registerAgentTriggers();

  tryCreateTrigger('@ez4/local-agent', {
    'emulator:getServices': ({ service, options, context }: EmulateServiceEvent) => {
      if (isAgentService(service)) {
        return registerLocalService(service, options, context);
      }
      if (isAgentWorkflowService(service)) {
        return registerLocalWorkflowService(service, options, context);
      }
      return null;
    }
  });
};
