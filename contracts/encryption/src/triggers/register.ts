import { registerTriggers as registerCommonTriggers } from '@ez4/common/library';
import { tryCreateTrigger } from '@ez4/project/library';

import { getEncryptionServicesMetadata } from '../metadata/service';
import { getEncryptionImportsMetadata } from '../metadata/import';
import { ImportType, ServiceType } from '../metadata/types';
import { getLinkedImport, getLinkedService } from './service';

export const registerTriggers = () => {
  registerCommonTriggers();

  tryCreateTrigger(ServiceType, {
    'metadata:getServices': getEncryptionServicesMetadata,
    'metadata:getLinkedService': getLinkedService
  });

  tryCreateTrigger(ImportType, {
    'metadata:getServices': getEncryptionImportsMetadata,
    'metadata:getLinkedService': getLinkedImport
  });
};
