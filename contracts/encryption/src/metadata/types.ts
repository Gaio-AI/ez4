import type { ServiceMetadata } from '@ez4/project/library';

import { createServiceMetadata } from '@ez4/project/library';

export const ServiceType = '@ez4/encryption';

export const ImportType = '@ez4/import:encryption';

export type EncryptionService = Omit<ServiceMetadata, 'variables' | 'services'> &
  Required<Pick<ServiceMetadata, 'variables' | 'services'>> & {
    type: typeof ServiceType;
    file?: string;
    description?: string;
  };

export type EncryptionImport = Omit<ServiceMetadata, 'variables' | 'services'> &
  Required<Pick<ServiceMetadata, 'variables' | 'services'>> & {
    type: typeof ImportType;
    file?: string;
    description?: string;
    reference: string;
    project: string;
  };

export const isEncryptionService = (service: ServiceMetadata): service is EncryptionService => {
  return service.type === ServiceType;
};

export const isEncryptionImport = (service: ServiceMetadata): service is EncryptionImport => {
  return service.type === ImportType;
};

export const createEncryptionService = (name: string, file?: string, description?: string) => {
  return {
    ...createServiceMetadata<EncryptionService>(ServiceType, name),
    ...(description && { description }),
    ...(file && { file }),
    variables: {},
    services: {}
  };
};

export const createEncryptionImport = (name: string, file?: string, description?: string) => {
  return {
    ...createServiceMetadata<EncryptionImport>(ImportType, name),
    ...(description && { description }),
    ...(file && { file }),
    variables: {},
    services: {}
  };
};
