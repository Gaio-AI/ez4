import type { Agent } from '@ez4/agent';
import { ECSClient, StopTaskCommand } from '@aws-sdk/client-ecs';
import { GetObjectCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { SendMessageCommand, SQSClient } from '@aws-sdk/client-sqs';

interface Invocation {
  correlation?: string;
  replyTo?: string;
  deadline?: string;
  taskArn?: string;
  cluster?: string;
}

type Result = Agent.Result<Agent.Service<Agent.Input, Agent.Output>>;

export interface DispatchPorts {
  get(key: string): Promise<string | undefined>;
  put(key: string, value: string): Promise<void>;
  putConditional(key: string, value: string): Promise<boolean>;
  list(prefix: string): Promise<string[]>;
  send(queueUrl: string, body: string, id: string, agentName: string): Promise<void>;
  stopTask?(cluster: string, taskArn: string): Promise<void>;
  now?(): Date;
}

const invocationKey = (agent: string, id: string) => `invocations/${agent}/${id}.json`;
const resultKey = (agent: string, id: string) => `results/${agent}/${id}.json`;
const markerKey = (agent: string, id: string) => `dispatched/${agent}/${id}`;

const readInvocation = async (ports: DispatchPorts, agent: string, id: string) => {
  const raw = await ports.get(invocationKey(agent, id));
  return raw ? (JSON.parse(raw) as Invocation) : undefined;
};

const dispatchResult = async (ports: DispatchPorts, agent: string, id: string, invocation: Invocation, result: Result) => {
  if (!invocation.replyTo) return;
  if (!(await ports.putConditional(markerKey(agent, id), (ports.now?.() ?? new Date()).toISOString()))) return;
  await ports.send(invocation.replyTo, JSON.stringify(result), id, agent);
};

export const dispatchTaskStopped = async (event: unknown, ports: DispatchPorts): Promise<void> => {
  if (!event || typeof event !== 'object' || !('source' in event) || event.source !== 'aws.ecs' || !('detail' in event)) return;
  const detail = event.detail;
  if (!detail || typeof detail !== 'object' || !('lastStatus' in detail) || detail.lastStatus !== 'STOPPED') return;
  const stopped = detail as {
    overrides?: { containerOverrides?: { environment?: { name: string; value: string }[] }[] };
    stoppedReason?: string;
    containers?: { exitCode?: number }[];
  };
  const env = stopped.overrides?.containerOverrides?.flatMap((container) => container.environment ?? []) ?? [];
  const agent = env.find((value) => value.name === 'EZ4_AGENT_NAME')?.value;
  const id = env.find((value) => value.name === 'EZ4_AGENT_ID')?.value;
  if (!agent || !id) return;
  const invocation = await readInvocation(ports, agent, id);
  if (!invocation) return;

  const key = resultKey(agent, id);
  const raw = await ports.get(key);
  let result: Result;
  if (raw) {
    result = JSON.parse(raw) as Result;
  } else {
    result = {
      id,
      agent,
      status: 'failed',
      error: {
        code: 'task_stopped',
        message: `${stopped.stoppedReason ?? 'Task stopped unexpectedly'} (exit code: ${stopped.containers?.[0]?.exitCode ?? -1})`
      },
      correlation: invocation.correlation,
      finishedAt: (ports.now?.() ?? new Date()).toISOString()
    };
    await ports.put(key, JSON.stringify(result));
  }
  await dispatchResult(ports, agent, id, invocation, result);
};

export const dispatchScheduledSweep = async (ports: DispatchPorts): Promise<void> => {
  const now = (ports.now?.() ?? new Date()).getTime();
  for (const key of await ports.list('invocations/')) {
    const match = /^invocations\/([^/]+)\/([^/]+)\.json$/.exec(key);
    if (!match) continue;
    const [, agent, id] = match;
    const invocation = await readInvocation(ports, agent, id);
    if (!invocation?.deadline || Date.parse(invocation.deadline) > now) continue;
    if (await ports.get(markerKey(agent, id))) continue;
    const existing = await ports.get(resultKey(agent, id));
    if (existing) {
      await dispatchResult(ports, agent, id, invocation, JSON.parse(existing) as Result);
      continue;
    }
    if (invocation.taskArn && invocation.cluster && ports.stopTask) {
      await ports.stopTask(invocation.cluster, invocation.taskArn);
    }
    const result: Result = {
      id,
      agent,
      status: 'timed_out',
      error: { code: 'timeout', message: 'Agent invocation exceeded its deadline' },
      correlation: invocation.correlation,
      finishedAt: new Date(now).toISOString()
    };
    await ports.put(resultKey(agent, id), JSON.stringify(result));
    await dispatchResult(ports, agent, id, invocation, result);
  }
};

export const dispatchDecision = async (event: unknown, ports: DispatchPorts): Promise<void> => {
  if (!event || typeof event !== 'object' || !('source' in event)) return;
  if (event.source === 'aws.ecs') await dispatchTaskStopped(event, ports);
  else if (event.source === 'aws.events') await dispatchScheduledSweep(ports);
};

export interface DispatcherContext {
  s3?: S3Client;
  sqs?: SQSClient;
  ecs?: ECSClient;
  bucket?: string;
  ports?: DispatchPorts;
}

export const dispatchHandler = async (event: unknown, context: DispatcherContext = {}): Promise<void> => {
  if (context.ports) return dispatchDecision(event, context.ports);
  const s3 = context.s3 ?? new S3Client();
  const sqs = context.sqs ?? new SQSClient();
  const ecs = context.ecs ?? new ECSClient();
  const bucket = context.bucket ?? process.env.EZ4_AGENT_BUCKET;
  if (!bucket) throw new Error('EZ4_AGENT_BUCKET is required');
  const ports: DispatchPorts = {
    async get(key) {
      try {
        const response = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
        return await response.Body?.transformToString();
      } catch (error: unknown) {
        if (isAwsError(error, 'NoSuchKey', 404)) return undefined;
        throw error;
      }
    },
    async put(key, value) {
      await s3.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: value, ContentType: 'application/json' }));
    },
    async putConditional(key, value) {
      try {
        await s3.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: value, IfNoneMatch: '*' }));
        return true;
      } catch (error: unknown) {
        if (isAwsError(error, 'PreconditionFailed', 412)) return false;
        throw error;
      }
    },
    async list(prefix) {
      const keys: string[] = [];
      let token: string | undefined;
      do {
        const page = await s3.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken: token }));
        keys.push(...(page.Contents ?? []).flatMap((item) => (item.Key ? [item.Key] : [])));
        token = page.NextContinuationToken;
      } while (token);
      return keys;
    },
    async send(queueUrl, body, id, agentName) {
      await sqs.send(
        new SendMessageCommand({ QueueUrl: queueUrl, MessageBody: body, MessageDeduplicationId: id, MessageGroupId: agentName })
      );
    },
    async stopTask(cluster, taskArn) {
      await ecs.send(new StopTaskCommand({ cluster, task: taskArn, reason: 'Agent deadline exceeded' }));
    }
  };
  await dispatchDecision(event, ports);
};

const isAwsError = (error: unknown, name: string, status: number): boolean =>
  error instanceof Error &&
  (error.name === name ||
    ('$metadata' in error &&
      typeof error.$metadata === 'object' &&
      error.$metadata !== null &&
      'httpStatusCode' in error.$metadata &&
      error.$metadata.httpStatusCode === status));
