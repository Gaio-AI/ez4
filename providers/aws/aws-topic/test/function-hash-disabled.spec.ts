import type { ContextSource } from '@ez4/project/library';
import type { EntryStates } from '@ez4/state';

import { describe, it } from 'node:test';
import { equal, notEqual } from 'node:assert/strict';

import { ArchitectureType, RuntimeType } from '@ez4/project';
import { createRole } from '@ez4/aws-identity';
import { createLogGroup } from '@ez4/aws-logs';

import { createSubscriptionFunction } from '../src/subscription/function/service';
import { getRoleDocument } from './common/role';

type FunctionContext = Record<string, ContextSource> | undefined;

const enabledClient: ContextSource = {
  module: 'HttpClient',
  from: '@ez4/aws-gateway/client/http',
  constructor: '@{EZ4_MODULE_IMPORT}.make(__EZ4_GATEWAY_ENDPOINT, {})',
  dependencyIds: ['gateway'],
  connectionIds: ['gateway']
};

const disabledClient: ContextSource = {
  module: 'HttpClient',
  from: '@ez4/aws-gateway/client/http',
  constructor: `@{EZ4_MODULE_IMPORT}.make('', {})`,
  disabledProject: '@test/owner'
};

const getFunctionHash = (context: FunctionContext, references?: string[]) => {
  const state: EntryStates = {};

  const roleState = createRole(state, [], {
    roleName: 'ez4-test-hash-role',
    roleDocument: getRoleDocument()
  });

  const logGroupState = createLogGroup(state, {
    groupName: 'ez4-test-hash-logs',
    retention: 1
  });

  const functionState = createSubscriptionFunction(state, roleState, logGroupState, {
    functionName: 'ez4-test-hash-lambda',
    architecture: ArchitectureType.Arm,
    runtime: RuntimeType.Node24,
    variables: [],
    memory: 128,
    timeout: 5,
    handler: {
      sourceFile: 'test/files/lambda.js',
      functionName: 'main',
      dependencies: []
    },
    context,
    references
  });

  return functionState.parameters.getFunctionHash();
};

describe('topic function hash with a disabled import', () => {
  it('assert :: an enabled import leaves the hash as without one', async () => {
    equal(await getFunctionHash({ ownerApi: enabledClient }, ['ownerApi']), await getFunctionHash(undefined));
  });

  it('assert :: switching the import off changes the hash', async () => {
    notEqual(
      await getFunctionHash({ ownerApi: disabledClient }, ['ownerApi']),
      await getFunctionHash({ ownerApi: enabledClient }, ['ownerApi'])
    );
  });

  it(`assert :: a disabled import the handler doesn't use leaves the hash`, async () => {
    equal(await getFunctionHash({ ownerApi: disabledClient, otherApi: enabledClient }, ['otherApi']), await getFunctionHash(undefined));
  });
});
