import type { AgentService } from '@ez4/agent/library';
import type { EcsTaskDefState } from '@ez4/aws-ecs';
import { describe, it } from 'node:test';
import { ok, equal, deepEqual } from 'node:assert/strict';
import { ServiceType } from '@ez4/agent/library';
import { buildTaskDefinitionInput } from '../src/agent/taskdef';
import { createEcsTaskDefinition, createEcsTaskDefStateId, EcsTaskDefServiceType } from '@ez4/aws-ecs';
import { getAgentsBaseName } from '../src/utils/names';
import type { DeployOptions } from '@ez4/project/library';

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
        baseName: getAgentsBaseName({ prefix: 'ez4', projectName: 'stg', branchName: '', lockId: 'x' } as DeployOptions),
        noProxy: '169.254.169.254',
        variables: { LINEAR_API_KEY: 'lin-key' }
      }
    );

    equal(taskDef.networkMode, 'awsvpc');
    equal(taskDef.family, 'ez4-stg-agents-implement-agent');
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
    equal(container.logConfiguration?.options?.['awslogs-group'], '/ez4/agents/implement');
    equal(container.logConfiguration?.options?.['awslogs-region'], 'us-east-1');

    const envMap = Object.fromEntries((container.environment ?? []).map((e) => [e.name, e.value]));
    equal(envMap['EZ4_AGENT_NAME'], 'ImplementAgent');
    equal(envMap['EZ4_AGENT_BUCKET'], 'ez4-stg-agents');
    equal(envMap['EZ4_AGENT_TIMEOUT'], '3600');
    equal(envMap['NO_PROXY'], '169.254.169.254');
    equal(envMap['EZ4_AGENT_ID'], undefined);
    // Declared variables reach the hooks' `context.variables`, which reads the container environment.
    equal(envMap['LINEAR_API_KEY'], 'lin-key');

    const secrets = container.secrets ?? [];
    const secretMap = Object.fromEntries(secrets.map((s) => [s.name, s.valueFrom]));
    equal(secretMap['ANTHROPIC_API_KEY'], 'arn:aws:secretsmanager:us-east-1:123456789012:secret:stg/anthropic-key');
    equal(secretMap['GITHUB_TOKEN'], 'arn:aws:secretsmanager:us-east-1:123456789012:secret:stg/github-app:private_key::');
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
        bucketName: 'agent-bucket',
        baseName: getAgentsBaseName({ prefix: 'ez4', projectName: 'stg', branchName: '', lockId: 'x' } as DeployOptions)
      }
    );

    equal(taskDef.cpu, '1024');
    equal(taskDef.memory, '2048');
    equal(taskDef.ephemeralStorage?.sizeInGiB, 21);

    const container = taskDef.containerDefinitions?.[0];
    ok(container !== undefined);
    const envMap = Object.fromEntries((container.environment ?? []).map((e) => [e.name, e.value]));
    equal(envMap['EZ4_AGENT_TIMEOUT'], '3600');
  });

  it('assert :: builds task definition with proxy configuration and secrets', () => {
    const dummyAgent = {
      type: ServiceType,
      name: 'ProxyAgent'
    } as unknown as AgentService;

    const taskDef = buildTaskDefinitionInput(
      dummyAgent,
      'ecr-uri',
      'arn:aws:iam::123456789012:role/task-role',
      'arn:aws:iam::123456789012:role/exec-role',
      'arn:aws:logs:us-east-1:123456789012:log-group:/ez4/agents/proxy-agent',
      {
        bucketName: 'agent-bucket',
        baseName: 'ez4-stg-agents',
        proxy: { url: 'http://proxy.x.local:3128', secretArn: 'arn:s' }
      }
    );

    const container = taskDef.containerDefinitions?.[0];
    ok(container !== undefined);

    const envMap = Object.fromEntries((container.environment ?? []).map((e) => [e.name, e.value]));
    equal(envMap['EZ4_AGENT_PROXY_URL'], 'http://proxy.x.local:3128');
    ok(envMap['NO_PROXY']?.includes('169.254.170.2'));

    const secrets = container.secrets ?? [];
    const proxyPasswordSecret = secrets.find((s) => s.name === 'EZ4_AGENT_PROXY_PASSWORD');
    deepEqual(proxyPasswordSecret, {
      name: 'EZ4_AGENT_PROXY_PASSWORD',
      valueFrom: 'arn:s:password::'
    });
  });

  it('assert :: creates task definition state entry with correct parameters and ID', () => {
    const states: Record<string, EcsTaskDefState> = {};

    const state = createEcsTaskDefinition(states, ['dep1'], {
      family: 'TestAgent',
      subnetIds: ['subnet-1'],
      securityGroupIds: ['sg-1']
    });

    equal(state.type, EcsTaskDefServiceType);
    equal(state.parameters.family, 'TestAgent');
    equal(state.entryId, createEcsTaskDefStateId('TestAgent'));
    deepEqual(state.dependencies, ['dep1']);
    ok(states[state.entryId] !== undefined);
  });
});
