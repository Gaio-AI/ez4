import type { DeployOptions, EventContext } from '@ez4/project/library';
import type { HttpImport } from '@ez4/gateway/library';
import type { HttpClientRequest } from '@ez4/gateway';
import type { EntryStates } from '@ez4/state';
import type { GatewayState } from '../src/gateway/types';
import type { TestContext } from 'node:test';

import { describe, it, mock } from 'node:test';
import { deepEqual, equal, ok } from 'node:assert/strict';

import { getDefinitionName } from '@ez4/project/library';
import { SchemaType } from '@ez4/schema';

import { prepareHttpImports, prepareHttpLinkedImport } from '../src/triggers/http/import';
import { isGatewayState } from '../src/gateway/utils';
import { HttpClient } from '../src/client/http';

type TestClient = Record<string, (request: HttpClientRequest) => Promise<unknown>>;

const PRIVATE_KEY = 'private-key-of-the-owner-api';

const VARIABLE_NAME = 'EZ4_HTTP_AUTHORIZATION_OWNER_API';

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
      serviceHost: 'localhost:3734'
    }
  }
} as DeployOptions;

const getService = (authorization?: HttpImport['authorization']) => {
  return {
    type: '@ez4/import:http',
    name: 'OwnerApi',
    reference: 'Api',
    project: '@test/owner',
    services: {},
    variables: {},
    context: {},
    authorization,
    routes: [
      {
        name: 'getItem',
        path: 'GET /items',
        authorizer: {
          name: 'authorizer',
          request: {
            headers: {
              type: SchemaType.Object,
              properties: {
                authorization: {
                  type: SchemaType.String
                }
              }
            }
          }
        },
        handler: {
          response: {
            status: 204
          }
        }
      }
    ]
  } as unknown as HttpImport;
};

type SourceVariables = {
  service?: Record<string, string>;
  project?: Record<string, string>;
};

const prepareSource = (service: HttpImport, variables: SourceVariables = {}) => {
  const state: EntryStates = {};
  const deployOptions = { ...options, variables: variables.project } as DeployOptions;

  const context = {
    role: null,
    setServiceState: mock.fn(),
    getServiceState: mock.fn(() => Object.values(state)[0]!),
    setVirtualServiceState: mock.fn(),
    getVirtualServiceState: mock.fn(),
    getDependencyFiles: mock.fn(() => [])
  } satisfies EventContext;

  prepareHttpImports({ state, service, metadata: {}, options: deployOptions, context });

  const [gatewayState] = Object.values(state);

  ok(gatewayState && isGatewayState(gatewayState));

  const target = { type: '@ez4/http', name: 'ConsumerApi', context: {}, variables: variables.service ?? {} };

  const source = prepareHttpLinkedImport({ service, options: deployOptions, context, target });

  ok(source);

  return {
    endpointName: getDefinitionName<GatewayState>(gatewayState.entryId, 'endpoint'),
    source
  };
};

// What the bundled function runs to build the client: the import replaced by the runtime client and the
// gateway endpoint defined, as the bundler does.
const makeClient = (constructor: string, endpointName: string) => {
  const factory = new Function('HttpClient', endpointName, `return ${constructor.replace('@{EZ4_MODULE_IMPORT}', 'HttpClient')};`);

  return factory(HttpClient, 'https://owner.test') as TestClient;
};

describe('aws gateway import authorization', () => {
  const service = getService({
    type: 'bearer',
    header: 'authorization',
    value: PRIVATE_KEY
  } as NonNullable<HttpImport['authorization']>);

  const sendRequest = async (t: TestContext, variableName: string, variables: SourceVariables = {}) => {
    const fetch = t.mock.method(globalThis, 'fetch', async () => new Response(null, { status: 204 }));

    const { source, endpointName } = prepareSource(service, variables);

    process.env[variableName] = PRIVATE_KEY;

    t.after(() => {
      delete process.env[variableName];
    });

    await makeClient(source.constructor, endpointName).getItem({});

    equal(fetch.mock.callCount(), 1);

    const [url, init] = fetch.mock.calls[0]!.arguments;

    equal(url, 'https://owner.test/items');

    return (init?.headers as Record<string, string>)['authorization'];
  };

  it('assert :: the key stays out of the client code and reaches the function as a variable', () => {
    const { source } = prepareSource(service);

    equal(source.constructor.includes(PRIVATE_KEY), false);

    deepEqual(source.variables, {
      [VARIABLE_NAME]: PRIVATE_KEY
    });
  });

  it('assert :: the client sends the key it reads from the variable', async (t) => {
    equal(await sendRequest(t, VARIABLE_NAME), `Bearer ${PRIVATE_KEY}`);
  });

  it('assert :: a key the linking service already declares is read from its variable, not copied', async (t) => {
    const variables = { service: { REGION: 'us-east-1', OWNER_PRIVATE_API_KEY: PRIVATE_KEY } };

    const { source } = prepareSource(service, variables);

    equal(source.variables, undefined);
    equal(source.constructor.includes(PRIVATE_KEY), false);
    equal(source.constructor.includes(VARIABLE_NAME), false);

    equal(await sendRequest(t, 'OWNER_PRIVATE_API_KEY', variables), `Bearer ${PRIVATE_KEY}`);
  });

  it('assert :: a key the project already declares is read from its variable, not copied', async (t) => {
    const variables = { project: { SHARED_OWNER_KEY: PRIVATE_KEY } };

    const { source } = prepareSource(service, variables);

    equal(source.variables, undefined);

    equal(await sendRequest(t, 'SHARED_OWNER_KEY', variables), `Bearer ${PRIVATE_KEY}`);
  });

  it('assert :: an import without authorization brings no variable', () => {
    const { source } = prepareSource(getService());

    equal(source.variables, undefined);
  });
});
