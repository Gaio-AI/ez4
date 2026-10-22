import type { EntryStates } from '@ez4/state';
import type { ObjectSchema } from '@ez4/schema';

import { describe, it } from 'node:test';
import { deepEqual, equal, ok } from 'node:assert/strict';
import { join } from 'node:path';
import { setTimeout } from 'node:timers/promises';

import { SQSClient, SendMessageCommand, ReceiveMessageCommand } from '@aws-sdk/client-sqs';
import { CloudWatchLogsClient, FilterLogEventsCommand } from '@aws-sdk/client-cloudwatch-logs';
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
  account: string;
  attempt: number;
  deferred: boolean;
  startedAt: number;
  endedAt: number;
};

const messageSchema: ObjectSchema = {
  type: SchemaType.Object,
  properties: {
    id: {
      type: SchemaType.String
    },
    account: {
      type: SchemaType.String
    },
    notBefore: {
      type: SchemaType.Number,
      optional: true
    }
  }
};

const name = 'ez4-test-queue-defer';
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
        runs.push(JSON.parse(entry.message));
      }
    }

    nextToken = page.nextToken;
  } while (nextToken);

  return runs.sort((a, b) => a.startedAt - b.startedAt);
};

describe('queue subscription defer and key concurrency', { timeout: 900000 }, () => {
  registerTriggers();

  it('assert :: a deferred message runs once due, and a key never runs twice at once', async () => {
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
        maxAttempts: 2
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
            Sid: 'AllowQueue',
            Effect: 'Allow',
            Action: ['sqs:ReceiveMessage', 'sqs:GetQueueAttributes', 'sqs:DeleteMessage', 'sqs:ChangeMessageVisibility', 'sqs:SendMessage'],
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
        sourceFile: join('test/files', 'defer-lab.js'),
        functionName: 'main',
        dependencies: []
      },
      backoff: { attempts: 2, minDelay: 2, maxDelay: 2, window: 0 },
      parallelism: 1,
      acknowledge: 'record',
      keyConcurrency: {
        tableName,
        key: ['account'],
        max: 1,
        lease: 30
      }
    });

    createMapping(localState, queueResource, functionResource, {
      fromService: functionResource.parameters.functionName,
      enabled: true,
      concurrency: 5,
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

      const send = (body: object) => {
        return sqs.send(new SendMessageCommand({ QueueUrl: queueUrl, MessageBody: JSON.stringify(body) }));
      };

      const notBefore = Date.now() + 20000;

      await Promise.all([
        send({ id: 'due-later', account: 'due', notBefore }),
        send({ id: 'held-1', account: 'held' }),
        send({ id: 'held-2', account: 'held' }),
        send({ id: 'held-3', account: 'held' }),
        send({ id: 'held-4', account: 'held' }),
        send({ id: 'other', account: 'other' })
      ]);

      // Lets the slot waits (5 to 30 seconds each) and the deferred message come back, and their log lines arrive.
      await setTimeout(150000);

      const runs = await readRuns();

      // The deferred message ran once deferred and once due, both as a first attempt.
      const dueRuns = runs.filter(({ id }) => id === 'due-later');

      deepEqual(
        dueRuns.map(({ attempt, deferred }) => ({ attempt, deferred })),
        [
          { attempt: 1, deferred: true },
          { attempt: 1, deferred: false }
        ]
      );

      ok(dueRuns[1].startedAt >= notBefore);

      // Every message of the held key ran once, one after another, and each as a first attempt.
      const heldRuns = runs.filter(({ account }) => account === 'held');

      deepEqual(heldRuns.map(({ id }) => id).sort(), ['held-1', 'held-2', 'held-3', 'held-4']);

      ok(heldRuns.every(({ attempt }) => attempt === 1));

      for (let index = 1; index < heldRuns.length; index++) {
        ok(heldRuns[index].startedAt >= heldRuns[index - 1].endedAt, `held runs overlap: ${JSON.stringify(heldRuns)}`);
      }

      equal(runs.filter(({ id }) => id === 'other').length, 1);

      const { Messages } = await sqs.send(new ReceiveMessageCommand({ QueueUrl: deadLetterUrl, WaitTimeSeconds: 1 }));

      equal(Messages?.length ?? 0, 0);
    } finally {
      await deploy(undefined, deployed, { force: true });
    }
  });
});
