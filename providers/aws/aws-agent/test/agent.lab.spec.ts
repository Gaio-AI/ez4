import { describe, it } from 'node:test';
import { equal, ok } from 'node:assert/strict';
import type { S3Client } from '@aws-sdk/client-s3';
import type { ECSClient } from '@aws-sdk/client-ecs';
import { SchemaType } from '@ez4/schema';
import type { Agent } from '@ez4/agent';
import { Client } from '../src/client';

describe('agent lab :: end-to-end integration', () => {
  interface EchoService extends Agent.Service<{ message: string }, { echo: string }> {}

  it('runs client invocation and checks Agent.Result<EchoService>', async () => {
    const memory = new Map<string, string>();
    const mockS3 = {
      send: async (cmd: { input?: { Key?: string; Body?: unknown } }) => {
        if (cmd.input?.Body && cmd.input?.Key) {
          const body = cmd.input.Body;
          memory.set(cmd.input.Key, Buffer.isBuffer(body) ? body.toString('utf-8') : String(body));
          return {};
        }
        if (cmd.input?.Key && memory.has(cmd.input.Key)) {
          return {
            Body: {
              [Symbol.asyncIterator]: async function* () {
                yield Buffer.from(memory.get(cmd.input!.Key!)!);
              }
            }
          };
        }
        const notFound = new Error('NoSuchKey');
        notFound.name = 'NoSuchKey';
        throw notFound;
      }
    };

    const mockEcs = {
      send: async () => ({ tasks: [{ taskArn: 'arn:123' }] })
    };

    const client = Client.make<EchoService>({
      agentName: 'EchoAgent',
      cluster: 'arn:aws:ecs:us-east-1:123:cluster/test-cluster',
      taskDefinition: 'arn:aws:ecs:us-east-1:123:task-definition/echo:1',
      bucket: 'test-bucket',
      subnets: ['subnet-1'],
      securityGroups: ['sg-1'],
      replyTo: 'https://sqs.us-east-1.amazonaws.com/123/EchoResults.fifo',
      inputSchema: {
        type: SchemaType.Object,
        properties: { message: { type: SchemaType.String } }
      },
      s3Client: mockS3 as unknown as S3Client,
      ecsClient: mockEcs as unknown as ECSClient
    });

    const res = await client.invoke({ message: 'ping' }, { correlation: JSON.stringify({ traceId: 'abc' }) });
    ok(res.id);

    // Simulate agent writing result
    const simulatedResult: Agent.Result<EchoService> = {
      id: res.id,
      agent: 'EchoAgent',
      status: 'succeeded',
      output: { echo: 'ping' },
      correlation: JSON.stringify({ traceId: 'abc' }),
      finishedAt: new Date().toISOString()
    };

    await mockS3.send({
      input: {
        Key: `results/EchoAgent/${res.id}.json`,
        Body: Buffer.from(JSON.stringify(simulatedResult))
      }
    });

    const result = await client.result(res.id);
    ok(result);
    equal(result?.status, 'succeeded');
    equal(result?.output?.echo, 'ping');
    equal(result?.correlation, JSON.stringify({ traceId: 'abc' }));
  });
});
