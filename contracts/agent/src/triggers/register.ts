import { registerTriggers as registerCommonTriggers } from '@ez4/common/library';
import { registerTriggers as registerSchemaTriggers } from '@ez4/schema/library';
import { tryCreateTrigger } from '@ez4/project/library';

import { getAgentServicesMetadata } from '../metadata/service';
import { ServiceType } from '../metadata/types';
import { getLinkedService } from './service';

export const registerTriggers = () => {
  registerCommonTriggers();
  registerSchemaTriggers();

  tryCreateTrigger(ServiceType, {
    'metadata:getServices': getAgentServicesMetadata,
    'metadata:getLinkedService': getLinkedService
  });
};
