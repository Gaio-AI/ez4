import type { TopicService } from '@ez4/topic/library';

import { describe, it, mock } from 'node:test';
import { deepEqual, equal, ok, rejects } from 'node:assert/strict';

import { MalformedEventError } from '@ez4/topic/utils';

import { createClientMock } from '../src/client/mock';
import { TopicTester } from '../src/service/tester';

const topicService = {
  type: '@ez4/topic',
  name: 'contractTopic',
  services: {},
  variables: {},
  subscriptions: [],
  schema: {
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
  }
} as unknown as TopicService;

describe('local topic client mock contract', () => {
  it('assert :: reject an event the schema refuses', async () => {
    const client = createClientMock('contractTopic', topicService);

    // The real client validates before publishing: `null` is not an absent optional field.
    await rejects(() => client.publishEvent({ id: 'a', note: null } as any), MalformedEventError);
  });

  it('assert :: deliver the event as subscribers receive it', async () => {
    const client = createClientMock('contractTopic', topicService);

    await client.publishEvent({ id: 'a', extra: 'dropped by the schema' } as any);

    deepEqual(client.delivered, [{ id: 'a' }]);
  });

  it('assert :: accept anything without a contract', async () => {
    const client = createClientMock('unknownTopic');

    await client.publishEvent({ id: 'a', note: null });

    deepEqual(client.delivered, []);
  });

  it('assert :: tester mock survives restoreAll from another spec', async () => {
    const client = TopicTester.getClientMock('anyTopic');

    await client.publishEvent({ id: 'a' });

    mock.restoreAll();

    await client.publishEvent({ id: 'b' });

    ok(client.publishEvent.mock);
    equal(client.publishEvent.mock.callCount(), 2);
  });
});
