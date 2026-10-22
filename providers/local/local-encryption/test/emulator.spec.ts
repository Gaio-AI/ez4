import type { EncryptionImport, EncryptionService } from '@ez4/encryption/library';
import type { Client } from '@ez4/encryption';
import type { EmulateServiceContext, ServeOptions, ServiceMetadata } from '@ez4/project/library';

import { describe, it } from 'node:test';
import { equal, ok } from 'node:assert/strict';

import { registerTriggers as registerKmsTriggers } from '@ez4/aws-kms';
import { registerTriggers } from '@ez4/local-encryption';
import { ImportType, ServiceType } from '@ez4/encryption/library';
import { triggerAllAsync } from '@ez4/project/library';

const consoleOptions: ServeOptions = {
  prefix: 'gaio',
  projectName: 'console',
  branchName: '',
  serviceHost: 'console.local',
  localOptions: {},
  testOptions: {},
  version: 0,
  local: true
};

const workflowOptions: ServeOptions = {
  ...consoleOptions,
  projectName: 'workflow',
  serviceHost: 'workflow.local',
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

const context: EmulateServiceContext = {
  makeClients: () => ({}),
  makeClient: () => undefined
};

const isEncryptionClient = (client: unknown): client is Client => {
  return typeof client === 'object' && client !== null && 'encrypt' in client && 'decrypt' in client;
};

const getEmulatedClient = async (service: ServiceMetadata, options: ServeOptions) => {
  const emulator = await triggerAllAsync('emulator:getServices', (handler) => handler({ service, options, context }));

  ok(emulator, `No emulator for ${service.name}.`);

  const client = emulator.exportHandler?.({});

  ok(isEncryptionClient(client));

  return client;
};

describe('encryption emulator', () => {
  registerKmsTriggers();
  registerTriggers();

  it('assert :: a service encrypts with the local key', async () => {
    const client = await getEmulatedClient(consoleSecrets, consoleOptions);

    const ciphertext = await client.encrypt('sk-local-secret', { accountId: 'a1' });

    ok(ciphertext.startsWith('ez4e1.local.'));
    equal(await client.decrypt(ciphertext, { accountId: 'a1' }), 'sk-local-secret');
  });

  it('assert :: an import opens what the imported project encrypted', async () => {
    const serviceClient = await getEmulatedClient(consoleSecrets, consoleOptions);
    const importClient = await getEmulatedClient(importedSecrets, workflowOptions);

    const ciphertext = await serviceClient.encrypt('sk-shared-secret', { accountId: 'a1' });

    equal(await importClient.decrypt(ciphertext, { accountId: 'a1' }), 'sk-shared-secret');
  });
});
