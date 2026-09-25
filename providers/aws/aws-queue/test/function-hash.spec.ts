import type { EntryStates } from '@ez4/state';

import { describe, it } from 'node:test';
import { notEqual } from 'node:assert/strict';
import { join } from 'node:path';

import { createQueueFunction } from '@ez4/aws-queue';
import { ArchitectureType, RuntimeType } from '@ez4/project';
import { createRole } from '@ez4/aws-identity';
import { createLogGroup } from '@ez4/aws-logs';

import { getRoleDocument } from './common/role';

const getFunctionHash = (parallelism: number) => {
  const localState: EntryStates = {};

  const roleResource = createRole(localState, [], {
    roleName: 'ez4-test-queue-hash-role',
    roleDocument: getRoleDocument()
  });

  const logGroupResource = createLogGroup(localState, {
    groupName: 'ez4-test-queue-hash-logs',
    retention: 1
  });

  const functionResource = createQueueFunction(localState, roleResource, logGroupResource, {
    functionName: 'ez4-test-queue-hash-lambda',
    architecture: ArchitectureType.Arm,
    runtime: RuntimeType.Node24,
    variables: [],
    memory: 128,
    timeout: 5,
    handler: {
      sourceFile: join('test/files', 'lambda.js'),
      functionName: 'main',
      dependencies: []
    },
    backoff: {
      attempts: 3,
      minDelay: 5,
      maxDelay: 60
    },
    parallelism
  });

  return functionResource.parameters.getFunctionHash();
};

describe('queue function hash', () => {
  it('assert :: a new parallelism rebundles the function', async () => {
    notEqual(await getFunctionHash(1), await getFunctionHash(3));
  });
});
