import { randomUUID } from 'node:crypto';
import type { Readable } from 'node:stream';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import { validate, getErrorDetails } from '@ez4/validator';
import type { ObjectSchema } from '@ez4/schema';
import type { Agent } from '@ez4/agent';
import { getWorkflowStateKey } from '../utils/names';

export interface WorkflowClientParameters {
  workflow: string;
  startQueueUrl: string;
  bucket: string;
  inputSchema: ObjectSchema;
  s3Client?: S3Client;
  sqsClient?: SQSClient;
}

export namespace WorkflowClient {
  export const make = <W extends Agent.Workflow<any, any, any>>(parameters: WorkflowClientParameters): Agent.WorkflowClient<W> => {
    const s3 = parameters.s3Client ?? new S3Client();
    const sqs = parameters.sqsClient ?? new SQSClient();

    return {
      async start(input: Agent.WorkflowInputOf<W>, options?: { runId?: string }): Promise<{ runId: string }> {
        const errors = await validate(input, parameters.inputSchema);
        if (errors && errors.length > 0) {
          throw new Error(`Workflow input validation failed: ${JSON.stringify(getErrorDetails(errors))}`);
        }

        const runId = options?.runId ?? randomUUID();
        const message = {
          type: 'start',
          runId,
          input
        };

        await sqs.send(
          new SendMessageCommand({
            QueueUrl: parameters.startQueueUrl,
            MessageBody: JSON.stringify(message)
          })
        );

        return { runId };
      },

      async status(runId: string): Promise<Agent.WorkflowRun<Agent.StateOf<W>> | undefined> {
        try {
          const res = await s3.send(
            new GetObjectCommand({
              Bucket: parameters.bucket,
              Key: getWorkflowStateKey(parameters.workflow, runId)
            })
          );
          if (!res.Body) {
            return undefined;
          }
          const raw = await streamToString(res.Body as Readable);
          return JSON.parse(raw) as Agent.WorkflowRun<Agent.StateOf<W>>;
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
