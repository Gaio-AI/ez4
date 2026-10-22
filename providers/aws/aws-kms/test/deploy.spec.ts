import type { EncryptionImport, EncryptionService } from '@ez4/encryption/library';
import type { DeployOptions, EventContext, ServiceMetadata } from '@ez4/project/library';
import type { EntryStates } from '@ez4/state';

import { describe, it } from 'node:test';
import { deepEqual, equal, ok, rejects } from 'node:assert/strict';

import { isKeyState, registerTriggers } from '@ez4/aws-kms';
import { ImportType, ServiceType } from '@ez4/encryption/library';
import { MissingImportedProjectError, triggerAllAsync } from '@ez4/project/library';

const consoleOptions = {
  prefix: 'gaio',
  projectName: 'console',
  branchName: '',
  serviceHost: 'console.local'
};

const workflowOptions: DeployOptions = {
  prefix: 'gaio',
  projectName: 'workflow',
  branchName: '',
  lockId: 'test',
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

const prepareResources = (service: ServiceMetadata, options: DeployOptions) => {
  const state: EntryStates = {};
  const serviceStates: string[] = [];

  const context: EventContext = {
    role: null,
    setServiceState: (_service, _options, entry) => serviceStates.push(entry.entryId),
    getServiceState: () => {
      throw new Error('No service state is read while preparing.');
    },
    setVirtualServiceState: () => {},
    getVirtualServiceState: () => undefined,
    getDependencyFiles: () => []
  };

  const prepared = triggerAllAsync('deploy:prepareResources', (handler) => {
    return handler({ state, service, metadata: {}, options, context });
  });

  return { prepared, state, serviceStates };
};

describe('prepare resources', () => {
  registerTriggers();

  it('assert :: a service gets its own key', async () => {
    const { prepared, state, serviceStates } = prepareResources(consoleSecrets, { ...consoleOptions, lockId: 'test' });

    ok(await prepared);

    const [key, ...rest] = Object.values(state);

    ok(key && isKeyState(key));
    equal(rest.length, 0);
    equal(key.parameters.aliasName, 'alias/gaio-console-secrets');
    deepEqual(serviceStates, [key.entryId]);
  });

  it('assert :: an import is prepared with no key of its own', async () => {
    const { prepared, state, serviceStates } = prepareResources(importedSecrets, workflowOptions);

    ok(await prepared);

    deepEqual(state, {});
    deepEqual(serviceStates, []);
  });

  it('assert :: an import of a project the options do not name fails the deploy', async () => {
    const { prepared } = prepareResources(importedSecrets, { ...workflowOptions, imports: {} });

    await rejects(prepared, MissingImportedProjectError);
  });
});
