import type { EntryStates, StepContext } from '@ez4/state';
import type { FunctionState } from '@ez4/aws-function';
import type { APIGatewayProxyStructuredResultV2 } from 'aws-lambda';

import { deepEqual, equal, notEqual, ok } from 'node:assert/strict';
import { describe, it } from 'node:test';
import { pathToFileURL } from 'node:url';
import { relative, resolve } from 'node:path';

import { lambdaContext } from './common/entry-point';
import { prepareServicesState } from './common/plan';

type EntryPoint = (event: unknown, context: typeof lambdaContext) => Promise<unknown>;

const stepContext = {
  getDependencies: () => [],
  getConnections: () => []
} as unknown as StepContext;

const getFunction = (state: EntryStates, functionSuffix: string) => {
  const functionState = Object.values(state).find((entry) => {
    return entry?.type === 'aws:lambda.function' && (entry as FunctionState).parameters.functionName.endsWith(functionSuffix);
  });

  ok(functionState);

  return functionState as FunctionState;
};

const getEntryPoint = async (state: EntryStates, functionSuffix: string): Promise<EntryPoint> => {
  const bundleFile = await getFunction(state, functionSuffix).parameters.getFunctionBundle(stepContext);

  const { apiEntryPoint } = await import(pathToFileURL(resolve(bundleFile)).href);

  return apiEntryPoint;
};

const sendRequest = async (entryPoint: EntryPoint, routeKey: string, role: string) => {
  const [method, path] = routeKey.split(' ');

  const event = {
    routeKey,
    headers: {},
    isBase64Encoded: false,
    requestContext: {
      timeEpoch: 0,
      http: {
        method,
        path
      },
      authorizer: {
        lambda: {
          identity: JSON.stringify({ role })
        }
      }
    }
  };

  const response = (await entryPoint(event, lambdaContext)) as APIGatewayProxyStructuredResultV2;

  return {
    status: response.statusCode,
    body: JSON.parse(response.body!)
  };
};

describe('aws gateway route guard', () => {
  it('assert :: the guard decides who reaches the handler of a route', async (t) => {
    t.mock.method(console, 'error', () => {});

    const state = await prepareServicesState('./test/files/plan-guarded.ts');

    const entryPoint = await getEntryPoint(state, '-list-items');

    deepEqual(await sendRequest(entryPoint, 'GET /items', 'reader'), {
      status: 200,
      body: { route: 'items', role: 'reader' }
    });

    const refused = await sendRequest(entryPoint, 'GET /items', 'guest');

    equal(refused.status, 403);
    equal(refused.body.message, 'Role guest is not allowed.');
  });

  it('assert :: each route of a group runs behind its own allow', async (t) => {
    t.mock.method(console, 'error', () => {});

    const state = await prepareServicesState('./test/files/plan-guarded.ts');

    const entryPoint = await getEntryPoint(state, '-group-tags');

    // Both routes have the same handler.
    equal((await sendRequest(entryPoint, 'GET /tags', 'writer')).status, 200);
    equal((await sendRequest(entryPoint, 'GET /tags', 'admin')).status, 403);

    equal((await sendRequest(entryPoint, 'POST /tags', 'admin')).status, 200);
    equal((await sendRequest(entryPoint, 'POST /tags', 'writer')).status, 403);
  });

  it('assert :: a function changes with what its routes allow and with the guard source', async () => {
    const before = await prepareServicesState('./test/files/plan-guarded.ts');
    const after = await prepareServicesState('./test/files/plan-guarded-allow.ts');

    for (const functionSuffix of ['-list-items', '-group-tags']) {
      const beforeParameters = getFunction(before, functionSuffix).parameters;
      const afterParameters = getFunction(after, functionSuffix).parameters;

      // The route declaration isn't a file of the bundle, so only the values hash can tell.
      notEqual(await beforeParameters.getFunctionHash(), await afterParameters.getFunctionHash());

      const [, dependencyFiles] = afterParameters.getFunctionFiles();

      ok(dependencyFiles.some((file) => relative(process.cwd(), file) === 'test/files/plan-guard.ts'));
    }
  });
});
