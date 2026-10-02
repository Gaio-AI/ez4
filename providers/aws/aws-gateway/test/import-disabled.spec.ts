import type { DeployOptions, EventContext, ImportOptions } from '@ez4/project/library';
import type { HttpImport } from '@ez4/gateway/library';
import type { HttpClientRequest } from '@ez4/gateway';
import type { EntryStates } from '@ez4/state';

import { describe, it, mock } from 'node:test';
import { deepEqual, equal, ok, rejects } from 'node:assert/strict';

import { HttpError } from '@ez4/gateway';
import { Logger } from '@ez4/logger';

import { prepareHttpImports, prepareHttpLinkedImport } from '../src/triggers/http/import';
import { isGatewayState } from '../src/gateway/utils';
import { HttpClient } from '../src/client/http';

type TestClient = Record<string, (request: HttpClientRequest) => Promise<unknown>>;

const ownerOptions: ImportOptions = {
  prefix: 'ez4',
  projectName: 'owner',
  branchName: '',
  serviceHost: 'localhost:3734'
};

const getOptions = (disabled?: boolean) => {
  return {
    prefix: 'ez4',
    projectName: 'consumer',
    branchName: '',
    lockId: 'lock',
    imports: {
      '@test/owner': {
        ...ownerOptions,
        ...(disabled && { disabled })
      }
    }
  } as DeployOptions;
};

const service = {
  type: '@ez4/import:http',
  name: 'OwnerApi',
  reference: 'Api',
  project: '@test/owner',
  services: {},
  variables: {},
  context: {},
  routes: [
    {
      name: 'getItem',
      path: 'GET /items',
      handler: {
        response: {
          status: 204
        }
      }
    }
  ]
} as unknown as HttpImport;

const getContext = (state: EntryStates) => {
  return {
    role: null,
    setServiceState: mock.fn(),
    getServiceState: mock.fn(() => Object.values(state)[0]!),
    setVirtualServiceState: mock.fn(),
    getVirtualServiceState: mock.fn(),
    getDependencyFiles: mock.fn(() => [])
  } satisfies EventContext;
};

// What the bundled function runs to build the client, with the import replaced by the runtime client.
const makeClient = (constructor: string) => {
  const factory = new Function('HttpClient', `return ${constructor.replace('@{EZ4_MODULE_IMPORT}', 'HttpClient')};`);

  return factory(HttpClient) as TestClient;
};

describe('aws gateway disabled import', () => {
  it('assert :: an enabled import looks the gateway up', () => {
    const state: EntryStates = {};
    const context = getContext(state);

    equal(prepareHttpImports({ state, service, options: getOptions(), context }), true);

    const [gatewayState] = Object.values(state);

    ok(gatewayState && isGatewayState(gatewayState));
    equal(gatewayState.parameters.import, true);

    const source = prepareHttpLinkedImport({ service, options: getOptions(), context });

    deepEqual(source?.dependencyIds, [gatewayState.entryId]);
    deepEqual(source?.connectionIds, [gatewayState.entryId]);
  });

  it('assert :: a disabled import has no gateway and says so', (t) => {
    const warn = t.mock.method(Logger, 'warn', () => {});

    const state: EntryStates = {};
    const context = getContext(state);

    equal(prepareHttpImports({ state, service, options: getOptions(true), context }), true);

    deepEqual(state, {});
    equal(context.setServiceState.mock.callCount(), 0);

    deepEqual(
      warn.mock.calls.map(({ arguments: [message] }) => message),
      [`Import @test/owner is disabled: OwnerApi isn't looked up and its client fails with 503.`]
    );
  });

  it('assert :: a disabled import client fails every operation with 503', async (t) => {
    const fetch = t.mock.method(globalThis, 'fetch', async () => new Response(null, { status: 204 }));

    const context = getContext({});

    const source = prepareHttpLinkedImport({ service, options: getOptions(true), context });

    ok(source);

    equal(source.dependencyIds, undefined);
    equal(source.connectionIds, undefined);
    equal(context.getServiceState.mock.callCount(), 0);

    const client = makeClient(source.constructor);

    await rejects(client.getItem({}), (error) => {
      return (
        error instanceof HttpError &&
        error.status === 503 &&
        error.message === `Imported service '@test/owner' is disabled in this deployment.`
      );
    });

    equal(fetch.mock.callCount(), 0);
  });
});
