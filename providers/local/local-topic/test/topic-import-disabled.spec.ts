import type { EmulateServiceContext, ServeOptions } from '@ez4/project/library';
import type { TopicImport } from '@ez4/topic/library';

import { describe, it } from 'node:test';
import { throws } from 'node:assert/strict';

import { registerRemoteService } from '../src/provider/remote';

const context = {
  makeClients: () => ({}),
  makeClient: () => undefined
} as unknown as EmulateServiceContext;

const options = {
  prefix: 'ez4',
  projectName: 'consumer',
  branchName: '',
  serviceHost: 'localhost:0',
  version: 1,
  localOptions: {},
  testOptions: {},
  imports: {
    owner: {
      prefix: 'ez4',
      projectName: 'owner',
      branchName: '',
      serviceHost: 'localhost:0',
      disabled: true
    }
  }
} as ServeOptions;

const service = {
  type: '@ez4/import:topic',
  name: 'disabledImport',
  reference: 'sharedTopic',
  project: 'owner',
  services: {},
  variables: {},
  subscriptions: [],
  schema: {
    type: 'object',
    properties: {}
  }
} as unknown as TopicImport;

describe('local topic disabled import', () => {
  it('assert :: a topic import of a disabled project fails', () => {
    throws(() => registerRemoteService(service, options, context), {
      message: `Import disabledImport of owner can't be disabled, only Http.Import supports a disabled project reference.`
    });
  });
});
