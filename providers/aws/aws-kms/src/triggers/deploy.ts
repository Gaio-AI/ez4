import type { ContextSource, PrepareResourceEvent, ServiceEvent } from '@ez4/project/library';

import { isEncryptionImport, isEncryptionService } from '@ez4/encryption/library';

import { createKey } from '../key/service';
import { getKeyState } from '../key/utils';
import { getImportedProjectOptions, getKeyAliasName } from './utils';

export const prepareServices = (event: PrepareResourceEvent) => {
  const { state, service, options, context } = event;

  if (!isEncryptionService(service)) {
    return false;
  }

  const keyState = createKey(state, {
    aliasName: getKeyAliasName(service, options),
    description: service.description,
    tags: options.tags
  });

  context.setServiceState(service, options, keyState);

  return true;
};

/**
 * The imported project deploys its own key and keeps it in its own state, where only that project's
 * deploy may delete it: an import adds nothing to this one, and only checks it names a known project.
 */
export const prepareImports = (event: PrepareResourceEvent) => {
  const { service, options } = event;

  if (!isEncryptionImport(service)) {
    return false;
  }

  getImportedProjectOptions(service, options.imports);

  return true;
};

const getLinkedClient = (aliasName: string, dependencyIds: string[]): ContextSource => {
  return {
    module: 'Client',
    from: '@ez4/aws-kms/client',
    constructor: `@{EZ4_MODULE_IMPORT}.make({ keyId: "${aliasName}" })`,
    dependencyIds
  };
};

export const prepareLinkedServices = (event: ServiceEvent) => {
  const { service, options, context } = event;

  if (isEncryptionService(service)) {
    const keyState = getKeyState(context, service.name, options);

    return getLinkedClient(getKeyAliasName(service, options), [keyState.entryId]);
  }

  if (isEncryptionImport(service)) {
    const importOptions = getImportedProjectOptions(service, options.imports);

    return getLinkedClient(getKeyAliasName(service, importOptions), []);
  }

  return null;
};
