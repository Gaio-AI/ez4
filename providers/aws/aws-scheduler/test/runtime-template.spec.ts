import type { EntryStates } from '@ez4/state';

import { describe, it } from 'node:test';
import { equal, ok } from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { createTargetFunction } from '@ez4/aws-scheduler';
import { ArchitectureType, RuntimeType } from '@ez4/project';
import { createRole } from '@ez4/aws-identity';
import { createLogGroup } from '@ez4/aws-logs';

import { getRoleDocument } from './common/role';

const createTestTarget = () => {
  const localState: EntryStates = {};

  const roleResource = createRole(localState, [], {
    roleName: 'ez4-test-scheduler-template-role',
    roleDocument: getRoleDocument()
  });

  const logGroupResource = createLogGroup(localState, {
    groupName: 'ez4-test-scheduler-template-logs',
    retention: 1
  });

  return createTargetFunction(localState, roleResource, logGroupResource, {
    functionName: 'ez4-test-scheduler-template-lambda',
    architecture: ArchitectureType.Arm,
    runtime: RuntimeType.Node24,
    variables: [],
    memory: 128,
    timeout: 5,
    handler: {
      sourceFile: join('test/files', 'lambda.js'),
      functionName: 'main',
      dependencies: []
    }
  });
};

describe('schedule target function', () => {
  it('assert :: the runtime template is hashed with the handler', () => {
    const functionResource = createTestTarget();

    const [, files] = functionResource.parameters.getFunctionFiles();
    const template = files.find((file) => file.endsWith(join('lib', 'event.ts')));

    ok(template && existsSync(template));
  });

  it('assert :: a failed run takes no asynchronous retries', () => {
    const functionResource = createTestTarget();

    equal(functionResource.parameters.retryAttempts, 0);
  });
});
