import { describe, it } from 'node:test';
import { equal, deepEqual, ok, rejects } from 'node:assert/strict';
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { ECSClient, RunTaskCommand } from '@aws-sdk/client-ecs';
import type { RunTaskCommandInput } from '@aws-sdk/client-ecs';
import { Client } from '../src/client';
import { SchemaType } from '@ez4/schema';
import type { ObjectSchema } from '@ez4/schema';
import type { Agent } from '@ez4/agent';
import { prepareLinkedService } from '../src/triggers/client';
import { InvalidReplyToError } from '@ez4/agent/library';
import type { EventContext, DeployOptions, ServiceMetadata } from '@ez4/project/library';
import type { QueueService } from '@ez4/queue/library';
import { QueueServiceType } from '@ez4/aws-queue';
import { createEcsClusterStateId } from '../src/cluster/service';
import { createEcsTaskDefStateId } from '../src/taskdef/service';
import { createBucketStateId } from '@ez4/aws-bucket';
import { getAgentBucketName, getAgentClusterName } from '../src/utils/names';
import { getDefinitionName } from '@ez4/project/library';
import type { EcsTaskDefState } from '../src/taskdef/types';

describe('client :: agent client', () => {
  const inputSchema: ObjectSchema = {
    type: SchemaType.Object,
    properties: { task: { type: SchemaType.String } }
  };

  interface TestService extends Agent.Service<{ task: string }, { result: string }> {}

  it('validates input, writes invocation with bound replyTo, triggers ecs run-task, and returns { id }', async () => {
    let s3Key = '';
    let s3Body: unknown = null;
    let runTaskInput: RunTaskCommandInput | undefined;

    const mockS3 = {
      send: async (cmd: unknown) => {
        if (cmd instanceof PutObjectCommand) {
          s3Key = cmd.input.Key ?? '';
          s3Body = JSON.parse(cmd.input.Body ? Buffer.from(cmd.input.Body as Uint8Array).toString() : '{}');
        }
        return {};
      }
    } as unknown as S3Client;

    const mockEcs = {
      send: async (cmd: unknown) => {
        if (cmd instanceof RunTaskCommand) {
          runTaskInput = cmd.input;
        }
        return { tasks: [{ taskArn: 'arn:aws:ecs:us-east-1:123:task/abc' }] };
      }
    } as unknown as ECSClient;

    const client = Client.make<TestService>({
      agentName: 'worker-agent',
      cluster: 'arn:aws:ecs:us-east-1:123:cluster/test-cluster',
      taskDefinition: 'arn:aws:ecs:us-east-1:123:task-definition/worker:1',
      bucket: 'ez4-agents-bucket',
      subnets: ['subnet-1', 'subnet-2'],
      securityGroups: ['sg-agents'],
      replyTo: 'https://sqs.us-east-1.amazonaws.com/123/results.fifo',
      inputSchema,
      s3Client: mockS3,
      ecsClient: mockEcs
    });

    const response = await client.invoke({ task: 'run-job' }, { correlation: JSON.stringify({ step: 1 }) });

    ok(response.id);
    equal(s3Key, `invocations/worker-agent/${response.id}.json`);
    deepEqual(s3Body, {
      input: { task: 'run-job' },
      correlation: JSON.stringify({ step: 1 }),
      replyTo: 'https://sqs.us-east-1.amazonaws.com/123/results.fifo'
    });

    ok(runTaskInput);
    equal(runTaskInput.cluster, 'arn:aws:ecs:us-east-1:123:cluster/test-cluster');
    equal(runTaskInput.taskDefinition, 'arn:aws:ecs:us-east-1:123:task-definition/worker:1');
    equal(runTaskInput.launchType, 'FARGATE');
    deepEqual(runTaskInput.networkConfiguration?.awsvpcConfiguration?.subnets, ['subnet-1', 'subnet-2']);
    deepEqual(runTaskInput.networkConfiguration?.awsvpcConfiguration?.securityGroups, ['sg-agents']);

    const containerOverride = runTaskInput.overrides?.containerOverrides?.[0];
    const envOverrides = containerOverride?.environment;
    ok(envOverrides?.find((e: { name?: string; value?: string }) => e.name === 'EZ4_AGENT_ID' && e.value === response.id));
    ok(envOverrides?.find((e: { name?: string; value?: string }) => e.name === 'EZ4_AGENT_NAME' && e.value === 'worker-agent'));
  });

  it('returns Agent.Result<S> | undefined on result(id)', async () => {
    const mockResult: Agent.Result<TestService> = {
      id: 'inv-123',
      agent: 'worker-agent',
      status: 'succeeded',
      output: { result: 'completed' },
      correlation: JSON.stringify({ step: 1 }),
      finishedAt: new Date().toISOString()
    };

    const mockS3 = {
      send: async (cmd: unknown) => {
        if (cmd instanceof GetObjectCommand && cmd.input.Key?.includes('inv-123')) {
          return {
            Body: {
              [Symbol.asyncIterator]: async function* () {
                yield Buffer.from(JSON.stringify(mockResult));
              }
            }
          };
        }
        const notFound = new Error('NoSuchKey');
        notFound.name = 'NoSuchKey';
        throw notFound;
      }
    } as unknown as S3Client;

    const client = Client.make<TestService>({
      agentName: 'worker-agent',
      cluster: 'cluster',
      taskDefinition: 'taskdef',
      bucket: 'bucket',
      subnets: ['s1'],
      securityGroups: ['sg1'],
      inputSchema,
      s3Client: mockS3,
      ecsClient: {} as unknown as ECSClient
    });

    const result = await client.result('inv-123');
    deepEqual(result, mockResult);

    const missing = await client.result('missing-id');
    equal(missing, undefined);
  });

  it('rejects invalid input schema before calling AWS services', async () => {
    let called = false;
    const client = Client.make<TestService>({
      agentName: 'worker-agent',
      cluster: 'cluster',
      taskDefinition: 'taskdef',
      bucket: 'bucket',
      subnets: ['subnet-1'],
      securityGroups: ['sg-agents'],
      inputSchema,
      s3Client: {
        send: async () => {
          called = true;
        }
      } as unknown as S3Client,
      ecsClient: {
        send: async () => {
          called = true;
        }
      } as unknown as ECSClient
    });

    await rejects(client.invoke({ invalid: 123 } as unknown as { task: string }), /Agent input validation failed/);
    equal(called, false);
  });
});

describe('client :: prepareLinkedService', () => {
  const options: DeployOptions = {
    prefix: 'test',
    projectName: 'my-project',
    branchName: 'main',
    lockId: 'test-lock'
  };

  const dummyAgentService: ServiceMetadata = {
    type: '@ez4/agent',
    name: 'WorkerAgent',
    context: {},
    variables: {},
    services: {}
  };

  const mockContext: EventContext = {
    role: null,
    setServiceState: () => {},
    getServiceState: (service: unknown) => {
      const name = typeof service === 'string' ? service : (service as ServiceMetadata).name;
      if (name === 'ValidQueue') {
        return {
          type: QueueServiceType,
          entryId: 'entry-queue-valid',
          dependencies: [],
          parameters: { queueName: 'valid-queue.fifo' }
        };
      }
      if (name === 'NonFifoQueue') {
        return {
          type: QueueServiceType,
          entryId: 'entry-queue-non-fifo',
          dependencies: [],
          parameters: { queueName: 'regular-queue' }
        };
      }
      throw new Error(`Service ${name} not found`);
    },
    setVirtualServiceState: () => {},
    getVirtualServiceState: () => {
      throw new Error('Not supported');
    },
    getDependencyFiles: () => []
  };

  it('prepares linked service without replyTo', async () => {
    const source = await prepareLinkedService({
      service: dummyAgentService,
      target: dummyAgentService,
      options,
      context: mockContext
    });

    ok(source);
    equal(source.module, 'Client');
    equal(source.from, '@ez4/aws-agent/client');
    ok(source.constructor.includes('@{EZ4_MODULE_IMPORT}.make('));
    ok(source.constructor.includes('"agentName":"WorkerAgent"'));
    const taskdefId = createEcsTaskDefStateId('WorkerAgent');
    const clusterId = createEcsClusterStateId(getAgentClusterName(options));
    ok(source.dependencyIds?.includes(taskdefId));
    ok(source.dependencyIds?.includes(createBucketStateId(getAgentBucketName(options))));
    ok(source.dependencyIds?.includes(clusterId));
    ok(source.constructor.includes(getDefinitionName<EcsTaskDefState>(taskdefId, 'subnetIds')));
    ok(source.constructor.includes(getDefinitionName<EcsTaskDefState>(taskdefId, 'securityGroupIds')));
    ok(source.constructor.includes(getAgentBucketName(options)));
    ok(!source.constructor.includes('-agents-cluster'));
    ok(!source.constructor.includes('"subnets":[]'));
  });

  it('prepares linked service with valid FIFO replyTo queue', async () => {
    const validFifoQueue = {
      type: '@ez4/queue',
      name: 'ValidQueue',
      context: {},
      variables: {},
      services: {},
      fifoMode: {
        groupId: 'test-group'
      }
    } as unknown as QueueService;

    const linkedAgent = {
      ...dummyAgentService,
      options: {
        replyTo: 'ValidQueue'
      }
    };

    const source = await prepareLinkedService({
      service: linkedAgent,
      target: dummyAgentService,
      options,
      context: mockContext,
      metadata: {
        ValidQueue: validFifoQueue
      }
    });

    ok(source);
    equal(source.module, 'Client');
    ok(source.constructor.includes('__EZ4_ENTRY_QUEUE_VALID_QUEUE_URL'));
    ok(source.dependencyIds?.includes('entry-queue-valid'));
  });

  it('rejects replyTo if service is not a FIFO queue', async () => {
    const nonFifoQueue = {
      type: '@ez4/queue',
      name: 'NonFifoQueue',
      context: {},
      variables: {},
      services: {}
      // fifoMode is undefined
    } as unknown as QueueService;

    const linkedAgent = {
      ...dummyAgentService,
      options: {
        replyTo: 'NonFifoQueue'
      }
    };

    await rejects(
      async () => {
        await prepareLinkedService({
          service: linkedAgent,
          target: dummyAgentService,
          options,
          context: mockContext,
          metadata: {
            NonFifoQueue: nonFifoQueue
          }
        });
      },
      (err: unknown) => {
        ok(err instanceof InvalidReplyToError);
        return true;
      }
    );
  });

  it('rejects replyTo if service is not found or not a queue', async () => {
    const linkedAgent = {
      ...dummyAgentService,
      options: {
        replyTo: 'UnknownService'
      }
    };

    await rejects(
      async () => {
        await prepareLinkedService({
          service: linkedAgent,
          target: dummyAgentService,
          options,
          context: mockContext,
          metadata: {}
        });
      },
      (err: unknown) => {
        ok(err instanceof InvalidReplyToError);
        return true;
      }
    );
  });
});
