import { randomUUID } from 'node:crypto';
import type { Readable } from 'node:stream';
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { ECSClient, RunTaskCommand } from '@aws-sdk/client-ecs';
import { validate, getErrorDetails } from '@ez4/validator';
import type { ObjectSchema } from '@ez4/schema';
import type { Agent } from '@ez4/agent';
import { AgentErrorCode, AgentResultStatus } from '@ez4/agent';
import { AGENT_CONTAINER_NAME } from './utils/names';

export { WorkflowClient, type WorkflowClientParameters, type WorkflowStageParameters } from './workflow/client';

export interface ClientParameters {
  agentName: string;
  cluster: string;
  taskDefinition: string;
  bucket: string;
  subnets: string[];
  securityGroups: string[];
  replyTo?: string;
  timeout?: number;
  inputSchema: ObjectSchema;
  s3Client?: S3Client;
  ecsClient?: ECSClient;
}

export namespace Client {
  export const make = <S extends Agent.Service<any, any>>(parameters: ClientParameters): Agent.Client<S> => {
    const s3 = parameters.s3Client ?? new S3Client();
    const ecs = parameters.ecsClient ?? new ECSClient();
    const timeout = parameters.timeout ?? 3600;

    return {
      async invoke(input: Agent.InputOf<S>, options?: Agent.InvokeOptions): Promise<{ id: string }> {
        const errors = await validate(input, parameters.inputSchema);
        if (errors && errors.length > 0) {
          throw new Error(`Agent input validation failed: ${JSON.stringify(getErrorDetails(errors))}`);
        }

        const id = options?.id ?? randomUUID();

        const now = Date.now();
        const deadline = new Date(now + (timeout + 300) * 1000).toISOString();
        const invocationPayload: {
          input: Agent.InputOf<S>;
          correlation?: string;
          replyTo?: string;
          deadline: string;
          cluster: string;
          taskArn?: string;
          workspace?: Agent.WorkspaceRef[];
        } = {
          input,
          correlation: options?.correlation,
          replyTo: parameters.replyTo,
          deadline,
          cluster: parameters.cluster,
          workspace: options?.workspace
        };

        try {
          await s3.send(
            new PutObjectCommand({
              Bucket: parameters.bucket,
              Key: `invocations/${parameters.agentName}/${id}.json`,
              Body: Buffer.from(JSON.stringify(invocationPayload), 'utf-8'),
              ContentType: 'application/json',
              ...(options?.id ? { IfNoneMatch: '*' } : {})
            })
          );
        } catch (error) {
          if (
            !options?.id ||
            !error ||
            typeof error !== 'object' ||
            !('$metadata' in error) ||
            !error.$metadata ||
            typeof error.$metadata !== 'object' ||
            !('httpStatusCode' in error.$metadata) ||
            error.$metadata.httpStatusCode !== 412
          )
            throw error;
          const existing = await s3.send(
            new GetObjectCommand({
              Bucket: parameters.bucket,
              Key: `invocations/${parameters.agentName}/${id}.json`
            })
          );
          if (!existing.Body) throw new Error(`Invocation ${id} has no envelope`);
          const envelope: unknown = JSON.parse(await streamToString(existing.Body as Readable));
          if (
            !envelope ||
            typeof envelope !== 'object' ||
            !('deadline' in envelope) ||
            typeof envelope.deadline !== 'string' ||
            !('cluster' in envelope) ||
            typeof envelope.cluster !== 'string' ||
            !('input' in envelope)
          ) {
            throw new Error(`Invocation ${id} has an invalid envelope`);
          }
          if ('taskArn' in envelope && typeof envelope.taskArn === 'string') return { id };
          Object.assign(invocationPayload, envelope);
        }

        const runTaskResult = await ecs.send(
          new RunTaskCommand({
            clientToken: id,
            cluster: parameters.cluster,
            taskDefinition: parameters.taskDefinition,
            launchType: 'FARGATE',
            networkConfiguration: {
              awsvpcConfiguration: {
                subnets: parameters.subnets,
                securityGroups: parameters.securityGroups,
                assignPublicIp: 'DISABLED'
              }
            },
            overrides: {
              containerOverrides: [
                {
                  name: AGENT_CONTAINER_NAME,
                  environment: [
                    { name: 'EZ4_AGENT_ID', value: id },
                    { name: 'EZ4_AGENT_NAME', value: parameters.agentName }
                  ]
                }
              ]
            },
            tags: [
              { key: 'ez4:agent', value: parameters.agentName },
              { key: 'ez4:invocation-id', value: id }
            ]
          })
        );

        const taskArn = runTaskResult.tasks?.[0]?.taskArn;
        if (runTaskResult.failures?.length || !taskArn) {
          const reasons =
            runTaskResult.failures
              ?.map((failure) => failure.reason)
              .filter(Boolean)
              .join(', ') || 'Task failed to start';
          const failedResult: Agent.Result<S> = {
            id,
            agent: parameters.agentName,
            status: AgentResultStatus.Failed,
            error: { code: AgentErrorCode.TaskStopped, message: reasons },
            correlation: invocationPayload.correlation,
            finishedAt: new Date().toISOString()
          };
          await s3.send(
            new PutObjectCommand({
              Bucket: parameters.bucket,
              Key: `results/${parameters.agentName}/${id}.json`,
              Body: Buffer.from(JSON.stringify(failedResult), 'utf-8'),
              ContentType: 'application/json'
            })
          );
          invocationPayload.deadline = new Date(now).toISOString();
          await s3.send(
            new PutObjectCommand({
              Bucket: parameters.bucket,
              Key: `invocations/${parameters.agentName}/${id}.json`,
              Body: Buffer.from(JSON.stringify(invocationPayload), 'utf-8'),
              ContentType: 'application/json'
            })
          );
          if (parameters.replyTo) return { id };
          throw new Error(`Failed to run ECS task for agent "${parameters.agentName}": ${reasons}`);
        }
        invocationPayload.taskArn = taskArn;
        await s3.send(
          new PutObjectCommand({
            Bucket: parameters.bucket,
            Key: `invocations/${parameters.agentName}/${id}.json`,
            Body: Buffer.from(JSON.stringify(invocationPayload), 'utf-8'),
            ContentType: 'application/json'
          })
        );

        return { id };
      },

      async result(id: string): Promise<Agent.Result<S> | undefined> {
        try {
          const res = await s3.send(
            new GetObjectCommand({
              Bucket: parameters.bucket,
              Key: `results/${parameters.agentName}/${id}.json`
            })
          );
          if (!res.Body) {
            return undefined;
          }
          const raw = await streamToString(res.Body as Readable);
          return JSON.parse(raw) as Agent.Result<S>;
        } catch (err: unknown) {
          if (err && typeof err === 'object' && ('name' in err || '$metadata' in err)) {
            const awsErr = err as { name?: string; $metadata?: { httpStatusCode?: number } };
            if (awsErr.name === 'NoSuchKey' || awsErr.$metadata?.httpStatusCode === 404) {
              return undefined;
            }
          }
          throw err;
        }
      }
    };
  };
}

async function streamToString(stream: Readable): Promise<string> {
  const candidate: unknown = stream;
  if (candidate && typeof candidate === 'object' && 'transformToString' in candidate && typeof candidate.transformToString === 'function') {
    const transformToString = candidate.transformToString as (encoding?: string) => Promise<string>;
    return transformToString('utf-8');
  }
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf-8');
}
