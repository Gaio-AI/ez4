import { describe, it } from 'node:test';
import { deepEqual, equal, rejects } from 'node:assert/strict';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import { SchemaType } from '@ez4/schema';
import type { ObjectSchema } from '@ez4/schema';
import type { Agent } from '@ez4/agent';
import { WorkflowClient } from '../src/workflow/client';

interface ReviewInput {
  issueId: string;
}

interface ReviewState {
  status: string;
}

interface ReviewWorkflow extends Agent.Workflow<ReviewInput, ReviewState, any> {}

const fakeSqs = () => {
  const sent: Array<{ QueueUrl?: string; MessageBody?: string }> = [];
  const client = {
    sent,
    send: async (command: unknown) => {
      if (command instanceof SendMessageCommand) {
        sent.push(command.input);
        return { MessageId: 'msg-1' };
      }
      return {};
    }
  } as unknown as SQSClient & { sent: typeof sent };
  return client;
};

const fakeS3 = (files: Record<string, string>) => {
  const client = {
    send: async (command: unknown) => {
      if (command instanceof GetObjectCommand) {
        const key = command.input.Key ?? '';
        if (key in files) {
          const content = files[key];
          return {
            Body: {
              transformToString: async () => content,
              [Symbol.asyncIterator]: async function* () {
                yield Buffer.from(content);
              }
            }
          };
        }
        const notFound = new Error('NoSuchKey');
        notFound.name = 'NoSuchKey';
        throw notFound;
      }
      return {};
    }
  } as unknown as S3Client;
  return client;
};

describe('workflow client', () => {
  const inputSchema: ObjectSchema = {
    type: SchemaType.Object,
    properties: {
      issueId: {
        type: SchemaType.String
      }
    }
  };

  it('assert :: start sends a start message and status reads the state', async () => {
    const sqs = fakeSqs();
    const s3 = fakeS3({
      'workflows/ReviewLoop/r1.json': JSON.stringify({
        runId: 'r1',
        status: 'running',
        step: 1,
        trigger: 'start',
        createdAt: 'x',
        updatedAt: 'x'
      })
    });
    const client = WorkflowClient.make<ReviewWorkflow>({
      workflow: 'ReviewLoop',
      startQueueUrl: 'q',
      bucket: 'b',
      inputSchema,
      s3Client: s3,
      sqsClient: sqs
    });

    deepEqual(await client.start({ issueId: 'i' }, { runId: 'r1' }), { runId: 'r1' });
    deepEqual(JSON.parse(sqs.sent[0].MessageBody!), { type: 'start', runId: 'r1', input: { issueId: 'i' } });
    deepEqual((await client.status('r1'))?.status, 'running');
    deepEqual(await client.status('missing'), undefined);
  });

  it('assert :: start generates randomUUID when runId is omitted', async () => {
    const sqs = fakeSqs();
    const s3 = fakeS3({});
    const client = WorkflowClient.make<ReviewWorkflow>({
      workflow: 'ReviewLoop',
      startQueueUrl: 'q',
      bucket: 'b',
      inputSchema,
      s3Client: s3,
      sqsClient: sqs
    });

    const res = await client.start({ issueId: 'i2' });
    equal(typeof res.runId, 'string');
    equal(res.runId.length > 0, true);
    deepEqual(JSON.parse(sqs.sent[0].MessageBody!), { type: 'start', runId: res.runId, input: { issueId: 'i2' } });
  });

  it('assert :: start rejects invalid input schema', async () => {
    const sqs = fakeSqs();
    const s3 = fakeS3({});
    const client = WorkflowClient.make<ReviewWorkflow>({
      workflow: 'ReviewLoop',
      startQueueUrl: 'q',
      bucket: 'b',
      inputSchema,
      s3Client: s3,
      sqsClient: sqs
    });

    await rejects(
      client.start({ issueId: 123 as unknown as string }),
      /Workflow input validation failed/
    );
  });
});
