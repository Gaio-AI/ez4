import type { OperationLogLine } from '@ez4/aws-common';
import type { ECSClient } from '@aws-sdk/client-ecs';
import type { ProxyServiceState } from '../src/proxy/ecs-types';
import type { StepOptions } from '@ez4/state';

import { describe, it, afterEach } from 'node:test';
import { equal, deepEqual, ok } from 'node:assert/strict';

import { setEcsClient } from '@ez4/aws-ecs';
import { buildCreateServiceInput, upsertProxyService } from '../src/proxy/ecs-client';
import { createProxyService, createProxyServiceStateId } from '../src/proxy/ecs-service';
import { getProxyServiceHandler } from '../src/proxy/ecs-handler';
import { ProxyServiceServiceType } from '../src/proxy/ecs-types';

describe('ECS proxy service', () => {
  afterEach(() => {
    setEcsClient(null);
  });

  const sampleParameters = {
    serviceName: 'test-proxy-service',
    baseName: 'ez4-test',
    clusterName: 'test-cluster',
    squidConfig: 'http_port 3128\n',
    region: 'us-east-1',
    subnetIds: ['subnet-1', 'subnet-2'],
    securityGroupIds: ['sg-1'],
    tags: { Env: 'test' }
  };

  it('assert :: buildCreateServiceInput sets desiredCount 1, launchType FARGATE, assignPublicIp DISABLED, serviceRegistries[0].registryArn', () => {
    const taskDefArn = 'arn:aws:ecs:us-east-1:123456789012:task-definition/ez4-test-proxy:1';
    const registryArn = 'arn:aws:servicediscovery:us-east-1:123456789012:service/srv-proxy';

    const input = buildCreateServiceInput(sampleParameters, taskDefArn, registryArn);

    equal(input.cluster, 'test-cluster');
    equal(input.serviceName, 'test-proxy-service');
    equal(input.taskDefinition, taskDefArn);
    equal(input.desiredCount, 1);
    equal(input.launchType, 'FARGATE');
    equal(input.propagateTags, 'SERVICE');
    ok(input.networkConfiguration?.awsvpcConfiguration !== undefined);
    equal(input.networkConfiguration.awsvpcConfiguration.assignPublicIp, 'DISABLED');
    deepEqual(input.networkConfiguration.awsvpcConfiguration.subnets, ['subnet-1', 'subnet-2']);
    deepEqual(input.networkConfiguration.awsvpcConfiguration.securityGroups, ['sg-1']);
    equal(input.serviceRegistries?.[0]?.registryArn, registryArn);
    deepEqual(input.tags, [{ key: 'Env', value: 'test' }]);
  });

  it('assert :: upsertProxyService sends CreateServiceCommand when DescribeServices returns empty services', async () => {
    const sentCommands: Array<{ name: string; input: unknown }> = [];

    const fakeClient = {
      send: async (command: { constructor: { name: string }; input: unknown }) => {
        sentCommands.push({ name: command.constructor.name, input: command.input });

        switch (command.constructor.name) {
          case 'RegisterTaskDefinitionCommand':
            return {
              taskDefinition: {
                taskDefinitionArn: 'arn:aws:ecs:us-east-1:123456789012:task-definition/ez4-test-proxy:1'
              }
            };
          case 'DescribeServicesCommand':
            return { services: [] };
          case 'CreateServiceCommand':
            return {
              service: {
                serviceArn: 'arn:aws:ecs:us-east-1:123456789012:service/test-cluster/test-proxy-service'
              }
            };
          default:
            throw new Error(`Unexpected command ${command.constructor.name}`);
        }
      }
    };

    setEcsClient(fakeClient as unknown as ECSClient);

    const stubLogger = { update: () => {} } as unknown as OperationLogLine;
    const taskDefInput = {
      family: 'ez4-test-proxy',
      containerDefinitions: []
    };

    const result = await upsertProxyService(
      stubLogger,
      sampleParameters,
      taskDefInput,
      'arn:aws:servicediscovery:us-east-1:123456789012:service/srv-proxy'
    );

    equal(result.serviceArn, 'arn:aws:ecs:us-east-1:123456789012:service/test-cluster/test-proxy-service');
    equal(result.taskDefinitionArn, 'arn:aws:ecs:us-east-1:123456789012:task-definition/ez4-test-proxy:1');

    ok(sentCommands.some((c) => c.name === 'CreateServiceCommand'));
    ok(!sentCommands.some((c) => c.name === 'UpdateServiceCommand'));
  });

  it('assert :: upsertProxyService sends UpdateServiceCommand when DescribeServices returns ACTIVE service', async () => {
    const sentCommands: Array<{ name: string; input: unknown }> = [];

    const fakeClient = {
      send: async (command: { constructor: { name: string }; input: unknown }) => {
        sentCommands.push({ name: command.constructor.name, input: command.input });

        switch (command.constructor.name) {
          case 'RegisterTaskDefinitionCommand':
            return {
              taskDefinition: {
                taskDefinitionArn: 'arn:aws:ecs:us-east-1:123456789012:task-definition/ez4-test-proxy:2'
              }
            };
          case 'DescribeServicesCommand':
            return {
              services: [
                {
                  serviceName: 'test-proxy-service',
                  status: 'ACTIVE'
                }
              ]
            };
          case 'UpdateServiceCommand':
            return {
              service: {
                serviceArn: 'arn:aws:ecs:us-east-1:123456789012:service/test-cluster/test-proxy-service'
              }
            };
          default:
            throw new Error(`Unexpected command ${command.constructor.name}`);
        }
      }
    };

    setEcsClient(fakeClient as unknown as ECSClient);

    const stubLogger = { update: () => {} } as unknown as OperationLogLine;
    const taskDefInput = {
      family: 'ez4-test-proxy',
      containerDefinitions: []
    };

    const result = await upsertProxyService(
      stubLogger,
      sampleParameters,
      taskDefInput,
      'arn:aws:servicediscovery:us-east-1:123456789012:service/srv-proxy'
    );

    equal(result.serviceArn, 'arn:aws:ecs:us-east-1:123456789012:service/test-cluster/test-proxy-service');
    equal(result.taskDefinitionArn, 'arn:aws:ecs:us-east-1:123456789012:task-definition/ez4-test-proxy:2');

    ok(sentCommands.some((c) => c.name === 'UpdateServiceCommand'));
    ok(!sentCommands.some((c) => c.name === 'CreateServiceCommand'));
  });

  it('assert :: createProxyService creates valid state entry with dependencies', () => {
    const states: Record<string, ProxyServiceState> = {};
    const state = createProxyService(states, sampleParameters, ['dep-1', 'dep-2']);

    equal(state.type, ProxyServiceServiceType);
    equal(state.parameters.serviceName, 'test-proxy-service');
    equal(state.entryId, createProxyServiceStateId('test-proxy-service'));
    deepEqual(state.dependencies, ['dep-1', 'dep-2']);
    ok(states[state.entryId] !== undefined);
  });

  it('assert :: handler equals compares serviceArn', () => {
    const handler = getProxyServiceHandler();

    const candidate: ProxyServiceState = {
      type: ProxyServiceServiceType,
      entryId: 'entry1',
      dependencies: [],
      parameters: sampleParameters,
      result: {
        serviceArn: 'arn:aws:ecs:us-east-1:123456789012:service/test-cluster/test-proxy-service',
        taskDefinitionArn: 'arn:aws:ecs:us-east-1:123456789012:task-definition/ez4-test-proxy:1'
      }
    };

    const same = { ...candidate };
    const diff = {
      ...candidate,
      result: { ...candidate.result!, serviceArn: 'arn:aws:ecs:other' }
    };

    ok(handler.equals(candidate, same));
    ok(!handler.equals(candidate, diff));
  });

  it('assert :: handler preview detects parameter changes', async () => {
    const handler = getProxyServiceHandler();
    const options = {} as StepOptions;

    const candidate: ProxyServiceState = {
      type: ProxyServiceServiceType,
      entryId: 'entry1',
      dependencies: [],
      parameters: sampleParameters
    };

    const same = { ...candidate };
    const diff: ProxyServiceState = {
      type: ProxyServiceServiceType,
      entryId: 'entry1',
      dependencies: [],
      parameters: { ...sampleParameters, clusterName: 'other-cluster' }
    };

    equal(await handler.preview(candidate, same, options), undefined);
    const changes = await handler.preview(candidate, diff, options);
    ok(changes !== undefined);
    equal(changes.counts, 1);
  });
});
