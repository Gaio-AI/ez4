import type { ServiceEmulators } from '../src/emulator/service';

import { describe, it } from 'node:test';
import { equal, throws } from 'node:assert/strict';

import { Tester } from '../src/emulator/tester';

describe('project tester', () => {
  const realClient = { name: 'real' };

  const service = {
    type: 'test',
    name: 'Queue',
    context: {},
    variables: {},
    services: {}
  };

  const emulators: ServiceEmulators = {
    'test-tester-queue': {
      type: 'Queue',
      name: 'Queue',
      identifier: 'test-tester-queue',
      service,
      exportHandler: () => realClient
    }
  };

  // A fresh module instance: `ez4 test` configures the packaged one for this project, which has no services.
  Tester.configure(emulators, {
    prefix: 'test',
    projectName: 'tester',
    branchName: ''
  });

  it('assert :: restore a client that was never mocked', () => {
    Tester.restoreServiceClient('Queue');

    equal(Tester.getServiceClient('Queue'), realClient);
  });

  it('assert :: restore after mocking twice', () => {
    Tester.mockServiceClient('Queue', { name: 'first mock' });
    Tester.mockServiceClient('Queue', { name: 'second mock' });

    Tester.restoreServiceClient('Queue');

    equal(Tester.getServiceClient('Queue'), realClient);
  });

  it('assert :: service metadata', () => {
    equal(Tester.getServiceMetadata('Queue'), service);
    equal(Tester.getServiceMetadata('Unknown'), undefined);
  });

  it('assert :: mock an unknown service', () => {
    throws(() => Tester.mockServiceClient('Unknown', {}));
  });
});
