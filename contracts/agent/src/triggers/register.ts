import { registerTriggers as registerCommonTriggers } from '@ez4/common/library';
import { registerTriggers as registerSchemaTriggers } from '@ez4/schema/library';
import { tryCreateTrigger } from '@ez4/project/library';

import { getAgentServicesMetadata } from '../metadata/service';
import { getAgentWorkflowServicesMetadata } from '../metadata/workflow';
import { ServiceType, WorkflowServiceType } from '../metadata/types';
import { getLinkedService } from './service';
import { getLinkedWorkflow } from './workflow';

export const registerTriggers = () => {
  registerCommonTriggers();
  registerSchemaTriggers();

  tryCreateTrigger(ServiceType, {
    'metadata:getServices': getAgentServicesMetadata,
    'metadata:getLinkedService': getLinkedService
  });

  tryCreateTrigger(WorkflowServiceType, {
    'metadata:getServices': getAgentWorkflowServicesMetadata,
    'metadata:getLinkedService': getLinkedWorkflow
  });
};
