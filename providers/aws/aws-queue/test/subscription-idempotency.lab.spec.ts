import type { EntryStates } from '@ez4/state';
import type { ObjectSchema } from '@ez4/schema';

import { describe, it } from 'node:test';
import { deepEqual, equal, ok } from 'node:assert/strict';
import { join } from 'node:path';
import { setTimeout } from 'node:timers/promises';

import { SQSClient, SendMessageCommand, ReceiveMessageCommand, GetQueueAttributesCommand } from '@aws-sdk/client-sqs';
import { CloudWatchLogsClient, FilterLogEventsCommand } from '@aws-sdk/client-cloudwatch-logs';
import { DynamoDBClient, GetItemCommand } from '@aws-sdk/client-dynamodb';
import { createQueueFunction, createMapping, createQueue, registerTriggers } from '@ez4/aws-queue';
import { AttributeKeyType, AttributeType, createTable } from '@ez4/aws-dynamodb';
import { ArchitectureType, RuntimeType } from '@ez4/project';
import { createPolicy, createRole } from '@ez4/aws-identity';
import { createLogGroup } from '@ez4/aws-logs';
import { deploy } from '@ez4/aws-common';
import { SchemaType } from '@ez4/schema';

import { getRoleDocument } from './common/role';

type Run = {
  id: string;
  attempt: number;
};

const messageSchema: ObjectSchema = {
  type: SchemaType.Object,
  properties: {
    id: {
      type: SchemaType.String
    },
    mode: {
      type: SchemaType.String,
      optional: true
    }
  }
};

const name = 'ez4-test-queue-idempotency';
const tableName = `${name}-claims`;
const logGroupName = `${name}-logs-${Date.now()}`;

const readRuns = async (): Promise<Run[]> => {
  const logs = new CloudWatchLogsClient({});
  const runs: Run[] = [];

  let nextToken: string | undefined;

  do {
    const page = await logs.send(new FilterLogEventsCommand({ logGroupName, nextToken }));

    for (const { message = '' } of page.events ?? []) {
      let entry;

      try {
        entry = JSON.parse(message);
      } catch {
        continue;
      }

      if (typeof entry.message === 'string' && entry.message.includes('"probe"')) {
        const { id, attempt } = JSON.parse(entry.message);

        runs.push({ id, attempt });
      }
    }

    nextToken = page.nextToken;
  } while (nextToken);

  return runs.sort((a, b) => a.id.localeCompare(b.id) || a.attempt - b.attempt);
};

const getClaimState = async (id: string) => {
  const { Item } = await new DynamoDBClient({}).send(
    new GetItemCommand({
      TableName: tableName,
      Key: { id: { S: JSON.stringify(['main', id]) } },
      ConsistentRead: true
    })
  );

  return Item?.state?.S;
};

describe('queue subscription idempotency', { timeout: 600000 }, () => {
  registerTriggers();

  it('assert :: each key runs once, a failure frees it and an unknown outcome keeps it', async () => {
    const localState: EntryStates = {};

    const deadLetterResource = createQueue(localState, undefined, {
      queueName: `${name}-dlq`,
      fifoMode: false
    });

    const queueResource = createQueue(localState, deadLetterResource, {
      queueName: name,
      fifoMode: false,
      timeout: 30,
      deadLetter: {
        maxAttempts: 3
      }
    });

    const tableResource = createTable(localState, {
      tableName,
      attributeSchema: [[{ attributeName: 'id', attributeType: AttributeType.String, keyType: AttributeKeyType.Hash }]],
      ttlAttribute: 'expires_at',
      allowDeletion: true
    });

    const policyResource = createPolicy(localState, {
      policyName: `${name}-policy`,
      policyDocument: {
        Version: '2012-10-17',
        Statement: [
          {
            Sid: 'AllowQueueConsumer',
            Effect: 'Allow',
            Action: ['sqs:ReceiveMessage', 'sqs:GetQueueAttributes', 'sqs:DeleteMessage', 'sqs:ChangeMessageVisibility'],
            Resource: ['arn:aws:sqs:*:*:ez4-*']
          },
          {
            Sid: 'AllowClaims',
            Effect: 'Allow',
            Action: ['dynamodb:UpdateItem', 'dynamodb:DeleteItem'],
            Resource: ['arn:aws:dynamodb:*:*:table/ez4-*-claims']
          },
          {
            Sid: 'AllowLogs',
            Effect: 'Allow',
            Action: ['logs:CreateLogStream', 'logs:PutLogEvents'],
            Resource: ['arn:aws:logs:*:*:log-group:ez4-test-*']
          }
        ]
      }
    });

    const roleResource = createRole(localState, [policyResource], {
      roleName: `${name}-role`,
      roleDocument: getRoleDocument()
    });

    const logGroupResource = createLogGroup(localState, {
      groupName: logGroupName,
      retention: 1
    });

    const functionResource = createQueueFunction(localState, roleResource, logGroupResource, {
      functionName: `${name}-lambda`,
      architecture: ArchitectureType.Arm,
      runtime: RuntimeType.Node24,
      dependencies: [tableResource.entryId],
      variables: [],
      memory: 256,
      timeout: 30,
      messageSchema,
      handler: {
        sourceFile: join('test/files', 'idempotency-lab.js'),
        functionName: 'main',
        dependencies: []
      },
      backoff: { attempts: 3, minDelay: 2, maxDelay: 2, window: 0 },
      parallelism: 1,
      acknowledge: 'record',
      idempotency: {
        tableName,
        key: ['id'],
        ttl: 3600,
        lease: 30
      }
    });

    createMapping(localState, queueResource, functionResource, {
      fromService: functionResource.parameters.functionName,
      enabled: true,
      batch: {
        size: 1
      }
    });

    const { result: deployed, errors } = await deploy(localState, undefined);

    try {
      deepEqual(errors, []);

      const queueUrl = (deployed[queueResource.entryId]?.result as { queueUrl?: string } | undefined)?.queueUrl;
      const deadLetterUrl = (deployed[deadLetterResource.entryId]?.result as { queueUrl?: string } | undefined)?.queueUrl;

      ok(queueUrl && deadLetterUrl);

      const sqs = new SQSClient({});

      // A role just created takes a while to reach Lambda, and the first logs would be lost.
      await setTimeout(30000);

      const send = async (body: object) => {
        await sqs.send(new SendMessageCommand({ QueueUrl: queueUrl, MessageBody: JSON.stringify(body) }));
      };

      // The same unit of work delivered twice, a failure that frees its key and an unknown outcome.
      await send({ id: 'twice' });
      await send({ id: 'fail-once', mode: 'fail-once' });
      await send({ id: 'unknown', mode: 'unknown' });

      await setTimeout(15000);

      await send({ id: 'twice' });
      await send({ id: 'unknown', mode: 'unknown' });

      // Lets the retry of the failure and the repeated deliveries run, and their log lines arrive.
      await setTimeout(45000);

      deepEqual(await readRuns(), [
        { id: 'fail-once', attempt: 1 },
        { id: 'fail-once', attempt: 2 },
        { id: 'twice', attempt: 1 },
        { id: 'unknown', attempt: 1 }
      ]);

      equal(await getClaimState('twice'), 'done');
      equal(await getClaimState('fail-once'), 'done');
      equal(await getClaimState('unknown'), 'unknown');

      const { Attributes } = await sqs.send(
        new GetQueueAttributesCommand({
          QueueUrl: queueUrl,
          AttributeNames: ['ApproximateNumberOfMessages', 'ApproximateNumberOfMessagesNotVisible']
        })
      );

      equal(Attributes?.ApproximateNumberOfMessages, '0');
      equal(Attributes?.ApproximateNumberOfMessagesNotVisible, '0');

      const { Messages } = await sqs.send(new ReceiveMessageCommand({ QueueUrl: deadLetterUrl, WaitTimeSeconds: 1 }));

      equal(Messages?.length ?? 0, 0);
    } finally {
      await deploy(undefined, deployed, { force: true });
    }
  });
});
