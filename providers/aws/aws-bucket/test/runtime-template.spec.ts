import type { EntryStates } from '@ez4/state';

import { describe, it } from 'node:test';
import { ok } from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { createBucketEventFunction } from '@ez4/aws-bucket';
import { ArchitectureType, RuntimeType } from '@ez4/project';
import { createRole } from '@ez4/aws-identity';
import { createLogGroup } from '@ez4/aws-logs';

import { getRoleDocument } from './common/role';

describe('bucket event function', () => {
  it('assert :: the runtime template is hashed with the handler', () => {
    const localState: EntryStates = {};

    const roleResource = createRole(localState, [], {
      roleName: 'ez4-test-bucket-template-role',
      roleDocument: getRoleDocument()
    });

    const logGroupResource = createLogGroup(localState, {
      groupName: 'ez4-test-bucket-template-logs',
      retention: 1
    });

    const functionResource = createBucketEventFunction(localState, roleResource, logGroupResource, {
      functionName: 'ez4-test-bucket-template-lambda',
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

    const [, files] = functionResource.parameters.getFunctionFiles();
    const template = files.find((file) => file.endsWith(join('lib', 'event.ts')));

    ok(template && existsSync(template));
  });
});
