import type { EncryptionImport, EncryptionService } from '@ez4/encryption/library';
import type { CommonOptions, ImportOptions } from '@ez4/project/library';

import { isEncryptionImport } from '@ez4/encryption/library';
import { getServiceName, MissingImportedProjectError, UnsupportedDisabledImportError } from '@ez4/project/library';

/**
 * The alias a service's key goes by, which is how every client names it: KMS gives the key itself
 * a random id.
 */
export const getKeyAliasName = (service: EncryptionService | EncryptionImport, options: CommonOptions) => {
  return `alias/${getServiceName(isEncryptionImport(service) ? service.reference : service, options)}`;
};

/**
 * The options of the project an encryption import names, under which its key's alias is found.
 */
export const getImportedProjectOptions = (service: EncryptionImport, imports: Record<string, ImportOptions> | undefined) => {
  const importOptions = imports?.[service.project];

  if (!importOptions) {
    throw new MissingImportedProjectError(service.project);
  }

  if (importOptions.disabled) {
    throw new UnsupportedDisabledImportError(service.name, service.project);
  }

  return importOptions;
};
