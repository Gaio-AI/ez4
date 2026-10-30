import { describe, it } from 'node:test';
import { equal, deepEqual, ok, rejects } from 'node:assert/strict';
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { ECSClient, RunTaskCommand } from '@aws-sdk/client-ecs';
import type { RunTaskCommandInput } from '@aws-sdk/client-ecs';
import type { EntryState } from '@ez4/state';
import { Client } from '../src/client';
import { SchemaType } from '@ez4/schema';
import type { ObjectSchema } from '@ez4/schema';
import { AgentResultStatus, type Agent } from '@ez4/agent';
import { prepareLinkedService } from '../src/triggers/client';
import { InvalidReplyToError } from '@ez4/agent/library';
import type { EventContext, DeployOptions, ServiceMetadata } from '@ez4/project/library';
import { QueueServiceType } from '@ez4/aws-queue';
import { createEcsClusterStateId, createEcsTaskDefStateId } from '@ez4/aws-ecs';
import { createBucketStateId } from '@ez4/aws-bucket';
import { AGENT_CONTAINER_NAME, getAgentBucketName, getAgentClusterName } from '../src/utils/names';
import { getDefinitionName } from '@ez4/project/library';
import type { EcsTaskDefState } from '@ez4/aws-ecs';

interface StoredInvocation {
  input: { task: string };
  correlation?: string;
  replyTo?: string;
  deadline: string;
  cluster: string;
  taskArn?: string;
  workspace?: Agent.WorkspaceRef[];
}

describe('client :: agent client', () => {
  const inputSchema: ObjectSchema = {
    type: SchemaType.Object,
    properties: { task: { type: SchemaType.String } }
  };

  interface TestService extends Agent.Service<{ task: string }, { result: string }> {}

  it('validates input, writes invocation with deadline/cluster, triggers ecs run-task, updates taskArn, and returns { id }', async () => {
    const putCalls: { key: string; body: StoredInvocation }[] = [];
    let runTaskInput: RunTaskCommandInput | undefined;

    const mockS3 = {
      send: async (cmd: unknown) => {
        if (cmd instanceof PutObjectCommand) {
          putCalls.push({
            key: cmd.input.Key ?? '',
            body: JSON.parse(cmd.input.Body ? Buffer.from(cmd.input.Body as Uint8Array).toString() : '{}') as StoredInvocation
          });
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

    const before = Date.now();
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
    const after = Date.now();

    ok(response.id);
    equal(putCalls.length, 2);

    // Initial invocation record
    equal(putCalls[0].key, `invocations/worker-agent/${response.id}.json`);
    equal(putCalls[0].body.input.task, 'run-job');
    equal(putCalls[0].body.correlation, JSON.stringify({ step: 1 }));
    equal(putCalls[0].body.replyTo, 'https://sqs.us-east-1.amazonaws.com/123/results.fifo');
    equal(putCalls[0].body.cluster, 'arn:aws:ecs:us-east-1:123:cluster/test-cluster');
    equal(putCalls[0].body.taskArn, undefined);

    const deadlineMs = Date.parse(putCalls[0].body.deadline);
    ok(!Number.isNaN(deadlineMs));
    ok(deadlineMs >= before + (3600 + 300) * 1000);
    ok(deadlineMs <= after + (3600 + 300) * 1000);

    // Updated invocation record with taskArn
    equal(putCalls[1].key, `invocations/worker-agent/${response.id}.json`);
    equal(putCalls[1].body.taskArn, 'arn:aws:ecs:us-east-1:123:task/abc');
    equal(putCalls[1].body.cluster, 'arn:aws:ecs:us-east-1:123:cluster/test-cluster');
    equal(putCalls[1].body.deadline, putCalls[0].body.deadline);

    ok(runTaskInput);
    equal(runTaskInput.cluster, 'arn:aws:ecs:us-east-1:123:cluster/test-cluster');
    equal(runTaskInput.taskDefinition, 'arn:aws:ecs:us-east-1:123:task-definition/worker:1');
    equal(runTaskInput.launchType, 'FARGATE');
    deepEqual(runTaskInput.networkConfiguration?.awsvpcConfiguration?.subnets, ['subnet-1', 'subnet-2']);
    deepEqual(runTaskInput.networkConfiguration?.awsvpcConfiguration?.securityGroups, ['sg-agents']);

    const containerOverride = runTaskInput.overrides?.containerOverrides?.[0];
    equal(containerOverride?.name, AGENT_CONTAINER_NAME);
    const envOverrides = containerOverride?.environment;
    ok(envOverrides?.find((e: { name?: string; value?: string }) => e.name === 'EZ4_AGENT_ID' && e.value === response.id));
    ok(envOverrides?.find((e: { name?: string; value?: string }) => e.name === 'EZ4_AGENT_NAME' && e.value === 'worker-agent'));
  });

  it('client RunTask input override name equals the taskdef container name', async () => {
    let runTaskInput: RunTaskCommandInput | undefined;
    const mockEcs = {
      send: async (cmd: unknown) => {
        if (cmd instanceof RunTaskCommand) {
          runTaskInput = cmd.input;
          return { tasks: [{ taskArn: 'arn:aws:ecs:us-east-1:123:task/abc' }] };
        }
        return {};
      }
    } as unknown as ECSClient;

    const client = Client.make({
      agentName: 'worker-agent',
      cluster: 'test-cluster',
      taskDefinition: 'task-def',
      bucket: 'test-bucket',
      subnets: ['subnet-1'],
      securityGroups: ['sg-1'],
      inputSchema: { type: SchemaType.Object, properties: {} },
      s3Client: { send: async () => ({}) } as unknown as S3Client,
      ecsClient: mockEcs
    });

    await client.invoke({});
    equal(runTaskInput?.overrides?.containerOverrides?.[0]?.name, AGENT_CONTAINER_NAME);
  });

  it('calculates deadline with custom timeout', async () => {
    let capturedBody: StoredInvocation | null = null;
    const mockS3 = {
      send: async (cmd: unknown) => {
        if (cmd instanceof PutObjectCommand) {
          capturedBody = JSON.parse(cmd.input.Body ? Buffer.from(cmd.input.Body as Uint8Array).toString() : '{}') as StoredInvocation;
        }
        return {};
      }
    } as unknown as S3Client;

    const mockEcs = {
      send: async () => ({ tasks: [{ taskArn: 'arn:test' }] })
    } as unknown as ECSClient;

    const before = Date.now();
    const client = Client.make<TestService>({
      agentName: 'fast-agent',
      cluster: 'cluster-arn',
      taskDefinition: 'task-arn',
      bucket: 'bucket',
      subnets: ['s1'],
      securityGroups: ['sg1'],
      timeout: 120,
      inputSchema,
      s3Client: mockS3,
      ecsClient: mockEcs
    });

    await client.invoke({ task: 'quick' });
    const after = Date.now();

    ok(capturedBody !== null);
    const deadlineMs = Date.parse((capturedBody as StoredInvocation).deadline);
    ok(deadlineMs >= before + (120 + 300) * 1000);
    ok(deadlineMs <= after + (120 + 300) * 1000);
  });

  it('returns Agent.Result<S> | undefined on result(id)', async () => {
    const mockResult: Agent.Result<TestService> = {
      id: 'inv-123',
      agent: 'worker-agent',
      status: AgentResultStatus.Succeeded,
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

  it('persists a failed result and rejects when ECS cannot start a task', async () => {
    for (const response of [{ failures: [{ reason: 'RESOURCE:MEMORY' }], tasks: [] }, { tasks: [] }]) {
      const writes: { key: string; body: unknown }[] = [];
      const client = Client.make<TestService>({
        agentName: 'worker-agent',
        cluster: 'cluster',
        taskDefinition: 'taskdef',
        bucket: 'bucket',
        subnets: ['s1'],
        securityGroups: ['sg1'],
        inputSchema,
        s3Client: {
          send: async (command: unknown) => {
            if (command instanceof PutObjectCommand) {
              writes.push({ key: command.input.Key!, body: JSON.parse(Buffer.from(command.input.Body as Uint8Array).toString()) });
            }
            return {};
          }
        } as unknown as S3Client,
        ecsClient: { send: async () => response } as unknown as ECSClient
      });

      const reason = response.failures?.[0]?.reason ?? 'Task failed to start';
      await rejects(client.invoke({ task: 'work' }, { correlation: 'trace' }), new RegExp(`worker-agent.*${reason}`));
      equal(writes.length, 3);
      const invocation = writes[0].body as StoredInvocation;
      const result = writes[1].body as Agent.Result<TestService>;
      const failedInvocation = writes[2].body as StoredInvocation;
      equal(invocation.correlation, 'trace');
      equal(writes[1].key, `results/worker-agent/${result.id}.json`);
      equal(writes[2].key, `invocations/worker-agent/${result.id}.json`);
      equal(failedInvocation.taskArn, undefined);
      equal(failedInvocation.deadline, new Date(Date.parse(invocation.deadline) - (3600 + 300) * 1000).toISOString());
      equal(result.agent, 'worker-agent');
      equal(result.status, 'failed');
      deepEqual(result.error, { code: 'task_stopped', message: reason });
      equal(result.correlation, 'trace');
    }
  });

  it('returns the id and leaves a sweep-ready failure when RunTask fails with a reply queue', async () => {
    const writes: { key: string; body: unknown }[] = [];
    const client = Client.make<TestService>({
      agentName: 'worker-agent',
      cluster: 'cluster',
      taskDefinition: 'taskdef',
      bucket: 'bucket',
      subnets: ['s1'],
      securityGroups: ['sg1'],
      replyTo: 'https://sqs.us-east-1.amazonaws.com/123/results.fifo',
      inputSchema,
      s3Client: {
        send: async (command: unknown) => {
          if (command instanceof PutObjectCommand) {
            writes.push({ key: command.input.Key!, body: JSON.parse(Buffer.from(command.input.Body as Uint8Array).toString()) });
          }
          return {};
        }
      } as unknown as S3Client,
      ecsClient: { send: async () => ({ failures: [{ reason: 'RESOURCE:MEMORY' }], tasks: [] }) } as unknown as ECSClient
    });

    const { id } = await client.invoke({ task: 'work' }, { correlation: 'trace' });
    equal(writes.length, 3);
    const result = writes[1].body as Agent.Result<TestService>;
    const invocation = writes[2].body as StoredInvocation;
    equal(writes[1].key, `results/worker-agent/${id}.json`);
    equal(writes[2].key, `invocations/worker-agent/${id}.json`);
    equal(result.status, 'failed');
    deepEqual(result.error, { code: 'task_stopped', message: 'RESOURCE:MEMORY' });
    equal(invocation.replyTo, 'https://sqs.us-east-1.amazonaws.com/123/results.fifo');
    equal(invocation.taskArn, undefined);
    equal(invocation.deadline, new Date(Date.parse((writes[0].body as StoredInvocation).deadline) - (3600 + 300) * 1000).toISOString());
  });

  it('rejects invalid input schema before calling AWS services', async () => {
    let called = false;
    const client = Client.make<TestService>({
      agentName: 'worker-agent',
      cluster: 'cluster',
      taskDefinition: 'taskdef',
      bucket: 'bucket',
      subnets: ['s1'],
      securityGroups: ['sg1'],
      inputSchema,
      s3Client: {
        send: async () => {
          called = true;
          return {};
        }
      } as unknown as S3Client,
      ecsClient: {} as unknown as ECSClient
    });

    await rejects(
      async () => {
        // @ts-expect-error Testing invalid runtime input type
        await client.invoke({ task: 12345 });
      },
      (err: Error) => {
        ok(err.message.includes('Agent input validation failed'));
        return true;
      }
    );

    equal(called, false);
  });

  it('assert :: invoke with an existing id and taskArn does not run a second task', async () => {
    let runTaskCalls = 0;
    const ecs = {
      send: async (cmd: unknown) => {
        if (cmd instanceof RunTaskCommand) {
          runTaskCalls++;
        }
        return { tasks: [{ taskArn: 'arn:aws:ecs:us-east-1:123:task/abc' }] };
      }
    } as unknown as ECSClient;
    const store = new Map<string, string>([
      ['invocations/Worker/id-1.json', JSON.stringify({ input: {}, taskArn: 'arn:task', deadline: 'x', cluster: 'c' })]
    ]);
    const s3 = {
      send: async (cmd: unknown) => {
        if (cmd instanceof PutObjectCommand && cmd.input.IfNoneMatch === '*' && store.has(cmd.input.Key ?? '')) {
          throw Object.assign(new Error('Precondition Failed'), { $metadata: { httpStatusCode: 412 } });
        }
        if (cmd instanceof GetObjectCommand) {
          const key = cmd.input.Key ?? '';
          const content = store.get(key);
          if (!content) {
            const err = new Error('NoSuchKey');
            err.name = 'NoSuchKey';
            throw err;
          }
          return {
            Body: {
              transformToString: async () => content,
              [Symbol.asyncIterator]: async function* () {
                yield Buffer.from(content);
              }
            }
          };
        }
        return {};
      }
    } as unknown as S3Client;
    const client = Client.make({
      agentName: 'Worker',
      cluster: 'arn:aws:ecs:us-east-1:123:cluster/test-cluster',
      taskDefinition: 'arn:aws:ecs:us-east-1:123:task-definition/worker:1',
      bucket: 'ez4-agents-bucket',
      subnets: ['subnet-1'],
      securityGroups: ['sg-agents'],
      inputSchema: { type: SchemaType.Object, properties: {} },
      s3Client: s3,
      ecsClient: ecs
    });
    deepEqual(await client.invoke({}, { id: 'id-1' }), { id: 'id-1' });
    deepEqual(runTaskCalls, 0);
  });

  it('assert :: RunTask is idempotent by invocation id', async () => {
    let lastRunTaskInput: RunTaskCommandInput | undefined;
    const ecs = {
      send: async (cmd: unknown) => {
        if (cmd instanceof RunTaskCommand) {
          lastRunTaskInput = cmd.input;
        }
        return { tasks: [{ taskArn: 'arn:aws:ecs:us-east-1:123:task/abc' }] };
      }
    } as unknown as ECSClient;
    const s3 = {
      send: async () => ({})
    } as unknown as S3Client;
    const client = Client.make({
      agentName: 'Worker',
      cluster: 'arn:aws:ecs:us-east-1:123:cluster/test-cluster',
      taskDefinition: 'arn:aws:ecs:us-east-1:123:task-definition/worker:1',
      bucket: 'ez4-agents-bucket',
      subnets: ['subnet-1'],
      securityGroups: ['sg-agents'],
      inputSchema: { type: SchemaType.Object, properties: {} },
      s3Client: s3,
      ecsClient: ecs
    });
    await client.invoke({}, { id: 'id-9' });
    deepEqual(lastRunTaskInput?.clientToken, 'id-9');
  });

  it('retries the same RunTask request after its invocation was created', async () => {
    const stored = new Map<string, string>();
    const runInputs: RunTaskCommandInput[] = [];
    const s3 = {
      send: async (command: unknown) => {
        if (command instanceof PutObjectCommand) {
          const key = command.input.Key!;
          if (command.input.IfNoneMatch === '*' && stored.has(key)) {
            throw Object.assign(new Error('Precondition Failed'), { $metadata: { httpStatusCode: 412 } });
          }
          stored.set(key, Buffer.from(command.input.Body as Uint8Array).toString());
          return {};
        }
        if (command instanceof GetObjectCommand) {
          const content = stored.get(command.input.Key!);
          if (!content) throw Object.assign(new Error('NoSuchKey'), { name: 'NoSuchKey' });
          return { Body: { transformToString: async () => content } };
        }
        throw new Error('Unexpected S3 command');
      }
    } as unknown as S3Client;
    const ecs = {
      send: async (command: unknown) => {
        if (!(command instanceof RunTaskCommand)) throw new Error('Unexpected ECS command');
        runInputs.push(command.input);
        if (runInputs.length === 1) throw new Error('Connection lost after RunTask');
        return { tasks: [{ taskArn: 'arn:task' }] };
      }
    } as unknown as ECSClient;
    const client = Client.make<TestService>({
      agentName: 'Worker',
      cluster: 'cluster',
      taskDefinition: 'task',
      bucket: 'bucket',
      subnets: ['subnet-1'],
      securityGroups: ['sg-1'],
      inputSchema,
      s3Client: s3,
      ecsClient: ecs
    });
    await rejects(client.invoke({ task: 'original' }, { id: 'retry-1', correlation: 'first' }), /Connection lost/);
    const initial = stored.get('invocations/Worker/retry-1.json');
    deepEqual(await client.invoke({ task: 'different' }, { id: 'retry-1', correlation: 'second' }), { id: 'retry-1' });
    deepEqual(runInputs[1], runInputs[0]);
    const final = JSON.parse(stored.get('invocations/Worker/retry-1.json')!) as StoredInvocation;
    const original = JSON.parse(initial!) as StoredInvocation;
    equal(final.deadline, original.deadline);
    deepEqual(final.input, original.input);
    equal(final.correlation, original.correlation);
    equal(final.taskArn, 'arn:task');
  });
  it('assert :: options.workspace is stored in the invocation envelope', async () => {
    let storedInvocation: StoredInvocation | undefined;
    const s3 = {
      send: async (cmd: unknown) => {
        if (cmd instanceof PutObjectCommand && typeof cmd.input.Body === 'object') {
          const bodyStr = cmd.input.Body.toString('utf-8');
          storedInvocation = JSON.parse(bodyStr);
        }
        return {};
      }
    } as unknown as S3Client;
    const ecs = {
      send: async () => ({ tasks: [{ taskArn: 'arn:aws:ecs:us-east-1:123:task/abc' }] })
    } as unknown as ECSClient;

    const client = Client.make({
      agentName: 'Worker',
      cluster: 'arn:aws:ecs:us-east-1:123:cluster/test-cluster',
      taskDefinition: 'arn:aws:ecs:us-east-1:123:task-definition/worker:1',
      bucket: 'ez4-agents-bucket',
      subnets: ['subnet-1'],
      securityGroups: ['sg-agents'],
      inputSchema: { type: SchemaType.Object, properties: {} },
      s3Client: s3,
      ecsClient: ecs
    });

    const workspaceRefs: Agent.WorkspaceRef[] = [{ repo: 'api', base: 'sha1', head: 'sha2', ref: 'refs/ez4/Agent/inv-1', changed: true }];

    await client.invoke({}, { id: 'inv-ws-1', workspace: workspaceRefs });
    deepEqual(storedInvocation?.workspace, workspaceRefs);
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
    getServiceState: (service: string | ServiceMetadata): EntryState => {
      const name = typeof service === 'string' ? service : service.name;
      if (name === 'ValidQueue') {
        return {
          type: QueueServiceType,
          entryId: 'entry-queue-valid',
          dependencies: [],
          parameters: {
            queueName: 'valid-queue.fifo',
            fifoMode: true
          },
          result: {
            queueUrl: 'https://sqs.us-east-1.amazonaws.com/123/valid-queue.fifo'
          }
        };
      }
      if (name === 'StandardQueue') {
        return {
          type: QueueServiceType,
          entryId: 'entry-queue-standard',
          dependencies: [],
          parameters: {
            queueName: 'standard-queue',
            fifoMode: false
          }
        };
      }
      if (name === 'MissingQueue') {
        throw new Error('Service not found');
      }
      return {
        type: 'mock',
        entryId: `entry-${name}`,
        dependencies: [],
        parameters: {}
      };
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
    ok(source.constructor.includes('"timeout":3600'));
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
    const linkedAgent = {
      ...dummyAgentService,
      options: {
        replyTo: 'ValidQueue'
      }
    };

    const source = await prepareLinkedService({
      service: linkedAgent,
      target: linkedAgent,
      options,
      context: mockContext
    });

    ok(source);
    ok(source.constructor.includes('"replyTo":'));
    ok(source.dependencyIds?.includes('entry-queue-valid'));
  });

  it('rejects replyTo if service is not a FIFO queue', async () => {
    const linkedAgent = {
      ...dummyAgentService,
      options: {
        replyTo: 'StandardQueue'
      }
    };

    await rejects(
      async () => {
        prepareLinkedService({
          service: linkedAgent,
          target: linkedAgent,
          options,
          context: mockContext
        });
      },
      (err: Error) => {
        ok(err instanceof InvalidReplyToError);
        return true;
      }
    );
  });

  it('rejects replyTo if service is not found or not a queue', async () => {
    const linkedAgent = {
      ...dummyAgentService,
      options: {
        replyTo: 'MissingQueue'
      }
    };

    await rejects(
      async () => {
        prepareLinkedService({
          service: linkedAgent,
          target: linkedAgent,
          options,
          context: mockContext
        });
      },
      (err: Error) => {
        ok(err instanceof InvalidReplyToError);
        return true;
      }
    );
  });
});
