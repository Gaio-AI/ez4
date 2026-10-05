import type { SendMessageCommand } from '@aws-sdk/client-sqs';
import type { DeployOptions, EventContext } from '@ez4/project/library';
import type { QueueService } from '@ez4/queue/library';
import type { ObjectSchema } from '@ez4/schema';
import type { TestContext } from 'node:test';

import { describe, it, mock } from 'node:test';
import { equal } from 'node:assert/strict';

import { SQSClient } from '@aws-sdk/client-sqs';
import { Client } from '@ez4/aws-queue/client';
import { QueueServiceType } from '@ez4/aws-queue';
import { SchemaType } from '@ez4/schema';

import { prepareLinkedClient } from '../src/triggers/client';

const options = {
  prefix: 'ez4',
  projectName: 'test',
  branchName: '',
  lockId: 'lock'
} as DeployOptions;

const schema: ObjectSchema = {
  type: SchemaType.Object,
  properties: {
    tenant: {
      type: SchemaType.String
    }
  }
};

const context = {
  getServiceState: mock.fn(() => ({
    type: QueueServiceType,
    entryId: 'queue-entry',
    dependencies: [],
    parameters: {}
  }))
} as unknown as EventContext;

const getService = (mode: Pick<QueueService, 'fifoMode' | 'fairMode'>) => {
  return {
    type: '@ez4/queue',
    name: 'TenantQueue',
    schema,
    subscriptions: [],
    ...mode
  } as unknown as QueueService;
};

// The constructor is code: its last argument is the mode the deployed client is built with.
const getLinkedMode = (service: QueueService): Client.Parameters<{ tenant: string }> => {
  const { constructor } = prepareLinkedClient(context, service, options);

  return JSON.parse(constructor.slice(constructor.lastIndexOf(', ') + 2, -1));
};

const getSentGroupId = async (t: TestContext, service: QueueService) => {
  const send = t.mock.method(SQSClient.prototype, 'send', async () => ({}));

  const client = Client.make('https://sqs.test/ez4-test-queue-mode', schema, getLinkedMode(service));

  await client.sendMessage({ tenant: 'tenant-a' });

  const [command] = send.mock.calls[0].arguments as unknown as [SendMessageCommand];

  return command.input.MessageGroupId;
};

describe('queue linked client mode', () => {
  it('assert :: a fair queue sends the tenant as the message group', async (t) => {
    const service = getService({ fairMode: { groupId: 'tenant' } });

    equal(await getSentGroupId(t, service), 'tenant-a');
  });

  it('assert :: a fifo queue sends the group it declares', async (t) => {
    const service = getService({ fifoMode: { groupId: 'tenant' } });

    equal(await getSentGroupId(t, service), 'tenant-a');
  });

  it('assert :: a queue without a mode sends no message group', async (t) => {
    const service = getService({});

    equal(await getSentGroupId(t, service), undefined);
  });
});
