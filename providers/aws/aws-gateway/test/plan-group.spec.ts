import type { EntryState, EntryStates, StepContext } from '@ez4/state';
import type { FunctionState } from '@ez4/aws-function';
import type { APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import type { IntegrationGroupRoute } from '../src/integration/function/types';

import { deepEqual, equal, notEqual, ok, rejects } from 'node:assert/strict';
import { describe, it } from 'node:test';
import { pathToFileURL } from 'node:url';
import { relative, resolve } from 'node:path';

import { ArchitectureType, LogLevel, RuntimeType } from '@ez4/project';
import { SchemaType } from '@ez4/schema';
import { createLogGroup } from '@ez4/aws-logs';
import { createRole } from '@ez4/aws-identity';

import { createIntegrationGroupFunction } from '../src/integration/function/service';
import { lambdaContext } from './common/entry-point';
import { planOptions, prepareServicesState } from './common/plan';
import { getRoleDocument } from './common/role';

const groupFunctionName = 'ez4-plan-test-items-service-group-items';

const countTypes = (entries: EntryState[]) => {
  const counts: Record<string, number> = {};

  for (const { type } of entries) {
    counts[type] = (counts[type] ?? 0) + 1;
  }

  return counts;
};

const getFunction = (state: EntryStates, functionName: string) => {
  const functionState = Object.values(state).find((entry) => {
    return entry?.type === 'aws:lambda.function' && (entry as FunctionState).parameters.functionName === functionName;
  });

  ok(functionState);

  return functionState as FunctionState;
};

const stepContext = {
  getDependencies: () => [],
  getConnections: () => []
} as unknown as StepContext;

describe('aws gateway plan of route groups', () => {
  it('assert :: moving n routes to a group plans +4, ~n and -4n', async () => {
    const before = await prepareServicesState('./test/files/plan-items.ts');
    const after = await prepareServicesState('./test/files/plan-items-group.ts');

    const created = Object.values(after).filter((entry) => !!entry && !before[entry.entryId]) as EntryState[];
    const deleted = Object.values(before).filter((entry) => !!entry && !after[entry.entryId]) as EntryState[];

    const updated = Object.values(after).filter((entry) => {
      const previous = entry && before[entry.entryId];

      return !!previous && JSON.stringify(previous) !== JSON.stringify(entry);
    }) as EntryState[];

    const integrationType = 'aws:api.integration';

    deepEqual(countTypes(created), {
      'aws:log.group': 1,
      'aws:lambda.function': 1,
      'aws:lambda.permission': 1,
      [integrationType]: 1
    });

    deepEqual(countTypes(deleted), {
      'aws:log.group': 3,
      'aws:lambda.function': 3,
      'aws:lambda.permission': 3,
      [integrationType]: 3
    });

    // Only the routes change, each one to the group's integration.
    deepEqual(countTypes(updated), {
      'aws:api.route': 3
    });

    const [groupIntegration] = created.filter(({ type }) => type === integrationType);

    for (const route of updated) {
      ok(route.dependencies.includes(groupIntegration.entryId));
    }
  });

  it('assert :: a group whose handler needs a vpc through its context requires the group to set vpc', async () => {
    const needVpc = (services: { routes: { group?: string; handler: { isolated?: boolean; provider?: object } }[]; context: object }[]) => {
      for (const service of services) {
        service.context = { cache: { requireVpc: true, constructor: 'Cache', module: 'cache', from: 'cache' } };

        const [route] = service.routes.filter((candidate) => candidate.group === 'items');

        route.handler.isolated = true;
        route.handler.provider = { services: { cache: 'cache' } };
      }
    };

    await rejects(prepareServicesState('./test/files/plan-items-group.ts', planOptions, needVpc), /set `vpc: true` on the group/);
  });

  it('assert :: the group function takes the group settings and every route', async () => {
    const state = await prepareServicesState('./test/files/plan-items-group.ts');

    const { parameters } = getFunction(state, groupFunctionName);

    equal(parameters.memory, 512);
    equal(parameters.timeout, 14);
    equal(parameters.description, 'Route group items');

    deepEqual(await parameters.getFunctionVariables(), {
      PROJECT_NAME: 'plan-test',
      ITEMS_TABLE: 'items',
      ITEMS_LIMIT: '100'
    });

    const [, files] = parameters.getFunctionFiles();

    deepEqual(files.map((file) => relative(process.cwd(), file)).sort(), [
      'lib/group.ts',
      'test/files/plan-delete-item.ts',
      'test/files/plan-handlers.ts'
    ]);

    // Routes outside the group keep their own function.
    equal(getFunction(state, 'ez4-plan-test-items-service-health').parameters.memory, 256);

    equal(parameters.systemLogLevel, undefined);
  });

  it('assert :: the project system log level reaches every function of the api', async () => {
    const state = await prepareServicesState('./test/files/plan-items-group.ts', {
      ...planOptions,
      defaults: {
        ...planOptions.defaults,
        systemLogLevel: LogLevel.Information
      }
    });

    const systemLogLevels = Object.fromEntries(
      ['group-items', 'health', 'items-authorizer'].map((name) => {
        return [name, getFunction(state, `ez4-plan-test-items-service-${name}`).parameters.systemLogLevel];
      })
    );

    deepEqual(systemLogLevels, {
      'group-items': LogLevel.Information,
      health: LogLevel.Information,
      'items-authorizer': LogLevel.Information
    });
  });

  it('assert :: the group bundle serves each route with its handler', async (t) => {
    t.mock.method(console, 'error', () => {});

    const state = await prepareServicesState('./test/files/plan-items-group.ts');

    const { parameters } = getFunction(state, groupFunctionName);

    const bundleFile = await parameters.getFunctionBundle(stepContext);

    const { apiEntryPoint } = await import(pathToFileURL(resolve(bundleFile)).href);

    const sendRequest = async (routeKey: string, path: string, pathParameters?: Record<string, string>) => {
      const [method] = routeKey.split(' ');

      const event = {
        routeKey,
        headers: {
          'x-trace-id': 'trace-bundle'
        },
        pathParameters,
        isBase64Encoded: false,
        requestContext: {
          timeEpoch: 0,
          http: {
            method,
            path
          }
        }
      };

      return (await apiEntryPoint(event, lambdaContext)) as APIGatewayProxyStructuredResultV2;
    };

    const getResponse = await sendRequest('GET /items/{itemId}', '/items/item-1', { itemId: 'item-1' });
    const deleteResponse = await sendRequest('DELETE /items/{itemId}', '/items/item-1', { itemId: 'item-1' });
    const unknownResponse = await sendRequest('GET /health', '/health');

    equal(getResponse.statusCode, 200);
    deepEqual(JSON.parse(getResponse.body!), { itemId: 'item-1', itemName: 'item' });

    equal(deleteResponse.statusCode, 204);

    // Served by its own function, never by the group.
    equal(unknownResponse.statusCode, 404);
  });

  it('assert :: the group hash covers its whole route table', async () => {
    const state: EntryStates = {};

    const roleState = createRole(state, [], {
      roleName: 'ez4-test-group-hash-role',
      roleDocument: getRoleDocument()
    });

    const logGroupState = createLogGroup(state, {
      groupName: 'ez4-test-group-hash-logs',
      retention: 1
    });

    const getRoute = (routeKey: string, functionName: string): IntegrationGroupRoute => ({
      routeKey,
      handler: {
        sourceFile: 'test/files/plan-handlers.ts',
        functionName,
        dependencies: ['test/files/plan-handlers.ts']
      },
      bodySchema: {
        type: SchemaType.Object,
        properties: {}
      },
      errorsMap: {},
      preferences: {}
    });

    const getHash = (routes: IntegrationGroupRoute[], listener?: string) => {
      const { parameters } = createIntegrationGroupFunction(state, roleState, logGroupState, {
        functionName: `ez4-test-group-hash-${Math.random()}`,
        groupName: 'group-hash',
        architecture: ArchitectureType.Arm,
        runtime: RuntimeType.Node24,
        variables: [],
        memory: 128,
        timeout: 5,
        routes,
        ...(listener && {
          listener: {
            sourceFile: 'test/files/plan-handlers.ts',
            functionName: listener
          }
        })
      });

      return parameters.getFunctionHash();
    };

    const getRoutes = () => [getRoute('GET /items', 'getItem'), getRoute('POST /items', 'createItem')];

    const baseHash = await getHash(getRoutes());

    equal(await getHash(getRoutes()), baseHash);

    const changes: [string, (routes: IntegrationGroupRoute[]) => void][] = [
      ['route key', (routes) => (routes[1].routeKey = 'PUT /items')],
      ['handler', (routes) => (routes[1].handler.functionName = 'health')],
      ['schema', (routes) => (routes[1].bodySchema = { type: SchemaType.Object, properties: {}, optional: true })],
      ['errors', (routes) => (routes[1].errorsMap = { ItemError: 409 })],
      ['preferences', (routes) => (routes[0].preferences = { strictQueryStrings: true })],
      ['scope', (routes) => (routes[0].scope = { clientVersion: 'x-client-version' })],
      ['routes', (routes) => routes.pop()]
    ];

    for (const [name, change] of changes) {
      const routes = getRoutes();

      change(routes);

      notEqual(await getHash(routes), baseHash, `${name} changes the hash`);
    }

    notEqual(await getHash(getRoutes(), 'itemsListener'), baseHash, 'listener changes the hash');

    // The source hash already follows the import graph, and identical bytes can skip the upload.
    const routes = getRoutes();

    routes[0].handler.dependencies.push('test/files/plan-delete-item.ts');

    equal(await getHash(routes), baseHash);
  });
});
