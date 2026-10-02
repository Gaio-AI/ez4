import type { ContextSource } from '@ez4/project/library';
import type { HttpImport } from '@ez4/gateway/library';
import type { EntryStates } from '@ez4/state';

import { describe, it } from 'node:test';
import { equal, notEqual } from 'node:assert/strict';

import { ArchitectureType, RuntimeType } from '@ez4/project';
import { createRole } from '@ez4/aws-identity';
import { createLogGroup } from '@ez4/aws-logs';

import { createIntegrationFunction } from '../src/integration/function/service';
import { createAuthorizerFunction } from '../src/authorizer/function/service';
import { IntegrationFunctionType } from '../src/integration/function/types';
import { prepareDisabledClient } from '../src/triggers/http/client';
import { getRoleDocument } from './common/role';

type FunctionContext = Record<string, ContextSource> | undefined;

const enabledClient: ContextSource = {
  module: 'HttpClient',
  from: '@ez4/aws-gateway/client/http',
  constructor: '@{EZ4_MODULE_IMPORT}.make(__EZ4_GATEWAY_ENDPOINT, {})',
  dependencyIds: ['gateway'],
  connectionIds: ['gateway']
};

const disabledClient = prepareDisabledClient({
  type: '@ez4/import:http',
  name: 'OwnerApi',
  reference: 'Api',
  project: '@test/owner',
  context: {},
  routes: []
} as unknown as HttpImport);

const getResources = () => {
  const state: EntryStates = {};

  const roleState = createRole(state, [], {
    roleName: 'ez4-test-hash-role',
    roleDocument: getRoleDocument()
  });

  const logGroupState = createLogGroup(state, {
    groupName: 'ez4-test-hash-logs',
    retention: 1
  });

  return { state, roleState, logGroupState };
};

const getCommonParameters = (context: FunctionContext, references?: string[]) => {
  return {
    functionName: 'ez4-test-hash-lambda',
    architecture: ArchitectureType.Arm,
    runtime: RuntimeType.Node24,
    variables: [],
    memory: 128,
    timeout: 5,
    context,
    references
  };
};

const getIntegrationHash = (context: FunctionContext, references?: string[]) => {
  const { state, roleState, logGroupState } = getResources();

  const functionState = createIntegrationFunction(state, roleState, logGroupState, {
    ...getCommonParameters(context, references),
    type: IntegrationFunctionType.HttpRequest,
    handler: {
      sourceFile: 'test/files/lambda.js',
      functionName: 'main',
      dependencies: []
    }
  });

  return functionState.parameters.getFunctionHash();
};

const getAuthorizerHash = (context: FunctionContext, references?: string[]) => {
  const { state, roleState, logGroupState } = getResources();

  const functionState = createAuthorizerFunction(state, roleState, logGroupState, {
    ...getCommonParameters(context, references),
    authorizer: {
      sourceFile: 'test/files/lambda.js',
      functionName: 'main',
      dependencies: []
    }
  });

  return functionState.parameters.getFunctionHash();
};

describe('aws gateway function hash with a disabled import', () => {
  for (const [kind, getHash] of [
    ['integration', getIntegrationHash],
    ['authorizer', getAuthorizerHash]
  ] as const) {
    it(`assert :: an enabled import leaves the ${kind} hash as without one`, async () => {
      equal(await getHash({ ownerApi: enabledClient }, ['ownerApi']), await getHash(undefined));
    });

    it(`assert :: switching the import off changes the ${kind} hash`, async () => {
      notEqual(await getHash({ ownerApi: disabledClient }, ['ownerApi']), await getHash({ ownerApi: enabledClient }, ['ownerApi']));
    });

    it(`assert :: a disabled import the ${kind} doesn't use leaves its hash`, async () => {
      equal(await getHash({ ownerApi: disabledClient, otherApi: enabledClient }, ['otherApi']), await getHash(undefined));
    });
  }
});
