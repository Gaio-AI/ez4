import type { AgentService } from '@ez4/agent/library';
import type { StepOptions } from '@ez4/state';
import type { EcsTaskDefState } from '../src/taskdef/types';
import { describe, it } from 'node:test';
import { ok, equal, deepEqual } from 'node:assert/strict';
import { ServiceType } from '@ez4/agent/library';
import {
  buildTaskDefinitionInput,
  createEcsTaskDefinition,
  createEcsTaskDefStateId
} from '../src/taskdef/service';
import { getEcsTaskDefHandler } from '../src/taskdef/handler';
import { EcsTaskDefServiceType } from '../src/taskdef/types';

describe('agent ECS task definition builder', () => {
  it('assert :: builds Fargate task definition with awsvpc, user 1000, and dropped capabilities', () => {
    const dummyAgent = {
      type: ServiceType,
      name: 'ImplementAgent',
      resources: {
        cpu: 2048,
        memory: 4096,
        storage: 60,
        timeout: 3600
      },
      secrets: {
        ANTHROPIC_API_KEY: 'stg/anthropic-key',
        GITHUB_TOKEN: 'stg/github-app:private_key'
      }
    } as unknown as AgentService;

    const taskDef = buildTaskDefinitionInput(
      dummyAgent,
      '123456789012.dkr.ecr.us-east-1.amazonaws.com/ez4-stg-implement:hash123',
      'arn:aws:iam::123456789012:role/ez4-stg-implement-task-role',
      'arn:aws:iam::123456789012:role/ez4-stg-implement-exec-role',
      'arn:aws:logs:us-east-1:123456789012:log-group:/ez4/agents/implement',
      {
        bucketName: 'ez4-stg-agents',
        noProxy: '169.254.169.254'
      }
    );

    equal(taskDef.networkMode, 'awsvpc');
    deepEqual(taskDef.requiresCompatibilities, ['FARGATE']);
    equal(taskDef.cpu, '2048');
    equal(taskDef.memory, '4096');
    equal(taskDef.ephemeralStorage?.sizeInGiB, 60);

    const container = taskDef.containerDefinitions?.[0];
    ok(container !== undefined);
    equal(container.user, '1000');
    equal(container.privileged, false);
    deepEqual(container.linuxParameters?.capabilities?.drop, ['ALL']);
    equal(container.logConfiguration?.logDriver, 'awslogs');
    equal(
      container.logConfiguration?.options?.['awslogs-group'],
      '/ez4/agents/implement'
    );
    equal(
      container.logConfiguration?.options?.['awslogs-region'],
      'us-east-1'
    );

    const envMap = Object.fromEntries(
      (container.environment ?? []).map((e) => [e.name, e.value])
    );
    equal(envMap['EZ4_AGENT_NAME'], 'ImplementAgent');
    equal(envMap['EZ4_AGENT_BUCKET'], 'ez4-stg-agents');
    equal(envMap['EZ4_AGENT_TIMEOUT'], '3600');
    equal(envMap['NO_PROXY'], '169.254.169.254');
    equal(envMap['EZ4_AGENT_ID'], undefined);

    const secrets = container.secrets ?? [];
    const secretMap = Object.fromEntries(secrets.map((s) => [s.name, s.valueFrom]));
    equal(
      secretMap['ANTHROPIC_API_KEY'],
      'arn:aws:secretsmanager:us-east-1:123456789012:secret:stg/anthropic-key'
    );
    equal(
      secretMap['GITHUB_TOKEN'],
      'arn:aws:secretsmanager:us-east-1:123456789012:secret:stg/github-app:private_key::'
    );
  });

  it('assert :: uses defaults when agent resources omitted', () => {
    const dummyAgent = {
      type: ServiceType,
      name: 'DefaultAgent'
    } as unknown as AgentService;

    const taskDef = buildTaskDefinitionInput(
      dummyAgent,
      'ecr-uri',
      'arn:aws:iam::123456789012:role/task-role',
      'arn:aws:iam::123456789012:role/exec-role',
      'arn:aws:logs:us-east-1:123456789012:log-group:/ez4/agents/default',
      {
        bucketName: 'agent-bucket'
      }
    );

    equal(taskDef.cpu, '1024');
    equal(taskDef.memory, '2048');
    equal(taskDef.ephemeralStorage?.sizeInGiB, 20);

    const container = taskDef.containerDefinitions?.[0];
    ok(container !== undefined);
    const envMap = Object.fromEntries(
      (container.environment ?? []).map((e) => [e.name, e.value])
    );
    equal(envMap['EZ4_AGENT_TIMEOUT'], '14400');
  });

  it('assert :: creates task definition state entry with correct parameters and ID', () => {
    const states: Record<string, EcsTaskDefState> = {};

    const state = createEcsTaskDefinition(
      states,
      {
        agentName: 'TestAgent',
        taskDefinition: {
          family: 'ez4-testagent',
          containerDefinitions: []
        }
      },
      ['dep1']
    );

    equal(state.type, EcsTaskDefServiceType);
    equal(state.parameters.agentName, 'TestAgent');
    equal(state.entryId, createEcsTaskDefStateId('TestAgent'));
    deepEqual(state.dependencies, ['dep1']);
    ok(states[state.entryId] !== undefined);
  });

  it('assert :: handler equals compares taskDefinitionArn', () => {
    const handler = getEcsTaskDefHandler();

    const candidate: EcsTaskDefState = {
      type: EcsTaskDefServiceType,
      entryId: 'entry1',
      dependencies: [],
      parameters: {
        agentName: 'TestAgent',
        taskDefinition: {
          family: 'ez4-testagent',
          containerDefinitions: []
        }
      },
      result: {
        family: 'ez4-testagent',
        revision: 1,
        taskDefinitionArn: 'arn:aws:ecs:us-east-1:123456789012:task-definition/ez4-testagent:1'
      }
    };

    const currentSame: EcsTaskDefState = {
      ...candidate
    };

    const currentDiff: EcsTaskDefState = {
      ...candidate,
      result: {
        ...candidate.result!,
        taskDefinitionArn: 'arn:aws:ecs:us-east-1:123456789012:task-definition/ez4-testagent:2'
      }
    };

    ok(handler.equals(candidate, currentSame));
    ok(!handler.equals(candidate, currentDiff));
  });

  it('assert :: handler preview detects changes', async () => {
    const handler = getEcsTaskDefHandler();
    const options = {} as StepOptions;
    const candidate: EcsTaskDefState = {
      type: EcsTaskDefServiceType,
      entryId: 'entry1',
      dependencies: [],
      parameters: {
        agentName: 'TestAgent',
        taskDefinition: {
          family: 'ez4-testagent',
          containerDefinitions: [],
          cpu: '2048'
        }
      }
    };

    const currentSame: EcsTaskDefState = {
      ...candidate
    };

    const currentDiff: EcsTaskDefState = {
      type: EcsTaskDefServiceType,
      entryId: 'entry1',
      dependencies: [],
      parameters: {
        agentName: 'TestAgent',
        taskDefinition: {
          family: 'ez4-testagent',
          containerDefinitions: [],
          cpu: '1024'
        }
      }
    };

    equal(await handler.preview(candidate, currentSame, options), undefined);

    const changes = await handler.preview(candidate, currentDiff, options);
    ok(changes !== undefined);
    equal(changes.counts, 1);
  });
});
