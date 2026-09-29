import type { QueueService } from '@ez4/queue/library';

import { describe, it, mock } from 'node:test';
import { deepEqual, equal, ok, rejects } from 'node:assert/strict';

import { MalformedMessageError, MissingMessageGroupError } from '@ez4/queue/utils';

import { createClientMock } from '../src/client/mock';
import { QueueTester } from '../src/service/tester';

const messageSchema = {
  type: 'object',
  properties: {
    id: {
      type: 'string'
    },
    note: {
      type: 'string',
      optional: true
    }
  }
};

const getQueueService = (mode?: Pick<QueueService, 'fifoMode' | 'fairMode'>) => {
  return {
    type: '@ez4/queue',
    name: 'contractQueue',
    services: {},
    variables: {},
    schema: messageSchema,
    subscriptions: [],
    ...mode
  } as unknown as QueueService;
};

describe('local queue client mock contract', () => {
  it('assert :: reject a message the schema refuses', async () => {
    const client = createClientMock('contractQueue', getQueueService());

    // The real client validates before sending: `null` is not an absent optional field.
    await rejects(() => client.sendMessage({ id: 'a', note: null } as any), MalformedMessageError);
  });

  it('assert :: deliver the message as the consumer receives it', async () => {
    const client = createClientMock('contractQueue', getQueueService());

    await client.sendMessage({ id: 'a', extra: 'dropped by the schema' } as any);

    deepEqual(client.delivered, [{ id: 'a' }]);
  });

  it('assert :: reject a fifo message without its group', async () => {
    const client = createClientMock('contractQueue', getQueueService({ fifoMode: { groupId: 'note' } }));

    await rejects(() => client.sendMessage({ id: 'a' }), MissingMessageGroupError);
  });

  it('assert :: reject a fair message without its group', async () => {
    const client = createClientMock('contractQueue', getQueueService({ fairMode: { groupId: 'note' } }));

    await rejects(() => client.sendMessage({ id: 'a' }), MissingMessageGroupError);
  });

  it('assert :: accept anything without a contract', async () => {
    const client = createClientMock('unknownQueue');

    await client.sendMessage({ id: 'a', note: null });

    deepEqual(client.delivered, []);
  });

  it('assert :: tester mock survives restoreAll from another spec', async () => {
    const client = QueueTester.getClientMock('anyQueue');

    await client.sendMessage({ id: 'a' });

    mock.restoreAll();

    await client.sendMessage({ id: 'b' });

    ok(client.sendMessage.mock);
    equal(client.sendMessage.mock.callCount(), 2);
  });
});
