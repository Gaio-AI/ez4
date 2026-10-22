import type { EncryptionImport, EncryptionService } from '@ez4/encryption/library';
import type { ImportOptions } from '@ez4/project/library';

import { describe, it } from 'node:test';
import { equal, throws } from 'node:assert/strict';

import { ImportType, ServiceType } from '@ez4/encryption/library';
import { MissingImportedProjectError, UnsupportedDisabledImportError } from '@ez4/project/library';

import { getImportedProjectOptions, getKeyAliasName } from '../src/triggers/utils';

const consoleOptions: ImportOptions = {
  prefix: 'gaio',
  projectName: 'console',
  branchName: '',
  serviceHost: 'console.local'
};

const workflowOptions = {
  prefix: 'gaio',
  projectName: 'workflow',
  branchName: '',
  imports: {
    console: consoleOptions
  }
};

const consoleSecrets: EncryptionService = {
  type: ServiceType,
  name: 'Secrets',
  context: {},
  variables: {},
  services: {}
};

const importedSecrets: EncryptionImport = {
  type: ImportType,
  name: 'ConsoleSecrets',
  context: {},
  variables: {},
  services: {},
  reference: 'Secrets',
  project: 'console'
};

describe('key alias', () => {
  it('assert :: names the key after the service and its project', () => {
    equal(getKeyAliasName(consoleSecrets, consoleOptions), 'alias/gaio-console-secrets');
  });

  it('assert :: an import names the key its project deployed', () => {
    const importOptions = getImportedProjectOptions(importedSecrets, workflowOptions.imports);

    equal(getKeyAliasName(importedSecrets, importOptions), getKeyAliasName(consoleSecrets, consoleOptions));
  });

  it('assert :: refuses an import of a project the options do not name', () => {
    throws(() => getImportedProjectOptions(importedSecrets, {}), MissingImportedProjectError);
    throws(() => getImportedProjectOptions(importedSecrets, undefined), MissingImportedProjectError);
  });

  it('assert :: refuses an import of a disabled project', () => {
    const imports = {
      console: { ...consoleOptions, disabled: true }
    };

    throws(() => getImportedProjectOptions(importedSecrets, imports), UnsupportedDisabledImportError);
  });
});
