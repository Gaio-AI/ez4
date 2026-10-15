import type { EcsTaskDefState } from '../src/taskdef/types';
import { describe, it } from 'node:test';
import { deepEqual, equal, ok } from 'node:assert/strict';
import { buildEfsVolume, createEcsTaskDefinition, createEcsTaskDefStateId } from '../src/taskdef/service';
import { getEcsTaskDefHandler } from '../src/taskdef/handler';
import { EcsTaskDefServiceType } from '../src/taskdef/types';

describe('ECS task definition handler and builder', () => {
  it('assert :: efs volume is registered with transit encryption and IAM', async () => {
    const volume = buildEfsVolume('workspace', 'fs-1', 'fsap-1');
    deepEqual(volume, {
      name: 'workspace',
      efsVolumeConfiguration: {
        fileSystemId: 'fs-1',
        transitEncryption: 'ENABLED',
        authorizationConfig: { accessPointId: 'fsap-1', iam: 'ENABLED' }
      }
    });
  });

  it('assert :: same hash skips re-registration', async () => {
    const handler = getEcsTaskDefHandler();
    const candidate: EcsTaskDefState = {
      type: EcsTaskDefServiceType,
      entryId: createEcsTaskDefStateId('test-family'),
      dependencies: [],
      parameters: {
        family: 'test-family',
        getTaskDefinition: () => ({ family: 'test-family', containerDefinitions: [] }),
        hash: 'h1',
        subnetIds: ['subnet-1'],
        securityGroupIds: ['sg-1']
      }
    };
    const current: EcsTaskDefState = {
      ...candidate,
      result: {
        taskDefinitionArn: 'arn:aws:ecs:us-east-1:123456789012:task-definition/test-family:1',
        family: 'test-family',
        revision: 1,
        subnetIds: ['subnet-1'],
        securityGroupIds: ['sg-1']
      }
    };

    deepEqual(handler.equals(candidate, current), true);

    const differentHash: EcsTaskDefState = {
      ...current,
      parameters: {
        ...current.parameters,
        hash: 'h2'
      }
    };
    deepEqual(handler.equals(candidate, differentHash), false);
  });

  it('assert :: creates task definition state entry with parameters and hash', () => {
    const state = {};
    const taskDef = createEcsTaskDefinition(state, [], {
      family: 'worker-agent',
      getTaskDefinition: () => ({ family: 'worker-agent', containerDefinitions: [] }),
      getTaskDefinitionHash: () => 'hash-12345',
      subnetIds: ['subnet-a'],
      securityGroupIds: ['sg-a']
    });

    equal(taskDef.type, EcsTaskDefServiceType);
    equal(taskDef.parameters.family, 'worker-agent');
    equal(taskDef.parameters.hash, 'hash-12345');
    ok(taskDef.entryId.length > 0);
  });
});
