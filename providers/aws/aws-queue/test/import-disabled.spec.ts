import type { DeployOptions, EventContext } from '@ez4/project/library';
import type { QueueImport } from '@ez4/queue/library';
import type { EntryStates } from '@ez4/state';

import { describe, it, mock } from 'node:test';
import { deepEqual, throws } from 'node:assert/strict';

import { prepareImports, prepareLinkedImports } from '../src/triggers/import';

const options = {
  prefix: 'ez4',
  projectName: 'consumer',
  branchName: '',
  lockId: 'lock',
  imports: {
    '@test/owner': {
      prefix: 'ez4',
      projectName: 'owner',
      branchName: '',
      serviceHost: 'localhost:3734',
      disabled: true
    }
  }
} as DeployOptions;

const service = {
  type: '@ez4/import:queue',
  name: 'OwnerQueue',
  reference: 'Queue',
  project: '@test/owner',
  services: {},
  variables: {},
  context: {},
  schema: {
    type: 'object',
    properties: {}
  },
  subscriptions: []
} as unknown as QueueImport;

const context = {
  role: null,
  setServiceState: mock.fn(),
  getServiceState: mock.fn(),
  setVirtualServiceState: mock.fn(),
  getVirtualServiceState: mock.fn(),
  getDependencyFiles: mock.fn(() => [])
} as unknown as EventContext;

const message = `Import OwnerQueue of @test/owner can't be disabled, only Http.Import supports a disabled project reference.`;

describe('aws queue disabled import', () => {
  it('assert :: a queue import of a disabled project fails the deploy', () => {
    const state: EntryStates = {};

    throws(() => prepareImports({ state, service, metadata: {}, options, context }), { message });

    deepEqual(state, {});
  });

  it('assert :: a queue import of a disabled project has no client', () => {
    throws(() => prepareLinkedImports({ service, options, context }), { message });
  });
});
