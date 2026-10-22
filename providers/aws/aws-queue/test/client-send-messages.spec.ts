import type { SendMessageBatchCommand, SendMessageBatchRequestEntry, SendMessageBatchResult } from '@aws-sdk/client-sqs';
import type { TestContext } from 'node:test';

import { afterEach, describe, it } from 'node:test';
import { deepEqual, equal, ok, rejects } from 'node:assert/strict';

import { SQSClient } from '@aws-sdk/client-sqs';
import { Client } from '@ez4/aws-queue/client';
import { SendMessagesError } from '@ez4/queue/utils';
import { SchemaType } from '@ez4/schema';
import { Runtime } from '@ez4/common';

type TestMessage = {
  id: string;
  group?: string;
  text?: string;
};

type BatchHandler = (entries: SendMessageBatchRequestEntry[]) => Promise<SendMessageBatchResult>;

const messageSchema = {
  type: SchemaType.Object,
  properties: {
    id: {
      type: SchemaType.String
    },
    group: {
      type: SchemaType.String,
      optional: true
    },
    text: {
      type: SchemaType.String,
      optional: true
    }
  }
} as const;

const acceptAll: BatchHandler = async (entries) => {
  return {
    Successful: entries.map(({ Id }) => ({ Id: Id!, MessageId: `message-${Id}`, MD5OfMessageBody: '' })),
    Failed: []
  };
};

const getMessages = (count: number, text?: string): TestMessage[] => {
  return Array.from({ length: count }, (_, index) => ({ id: `${index}`, group: `group-${index % 3}`, text }));
};

const mockBatches = (t: TestContext, handler: BatchHandler = acceptAll) => {
  const batches: SendMessageBatchRequestEntry[][] = [];

  let inFlight = 0;
  let maxInFlight = 0;

  t.mock.method(SQSClient.prototype, 'send', async (command: SendMessageBatchCommand) => {
    const entries = command.input.Entries ?? [];

    batches.push(entries);

    maxInFlight = Math.max(maxInFlight, ++inFlight);

    try {
      // Yields so batches sent in parallel overlap.
      await new Promise((resolve) => setTimeout(resolve, 5));

      return await handler(entries);
    } finally {
      inFlight--;
    }
  });

  return {
    batches,
    getMaxInFlight: () => maxInFlight
  };
};

const getFailures = async (promise: Promise<void>) => {
  try {
    await promise;
  } catch (error) {
    ok(error instanceof SendMessagesError);

    return error.failures.map(({ index, message, error }) => ({ index, id: (message as TestMessage).id, reason: error.message }));
  }

  throw new Error('Expected sendMessages to fail.');
};

describe('queue client send messages', () => {
  const standardClient = Client.make<TestMessage, { fairMode: true }>('https://sqs.test/ez4-test-standard', messageSchema);

  const fifoClient = Client.make<TestMessage, { fifoMode: true }>('https://sqs.test/ez4-test.fifo', messageSchema, {
    fifoMode: {
      groupId: 'group',
      uniqueId: 'id'
    }
  });

  afterEach(() => {
    Runtime.clearScope();
  });

  it('assert :: up to 10 messages go in each request', async (t) => {
    const { batches } = mockBatches(t);

    await standardClient.sendMessages(getMessages(23));

    deepEqual(
      batches.map((entries) => entries.length),
      [10, 10, 3]
    );

    const sentIds = batches.flat().map(({ MessageBody }) => JSON.parse(MessageBody!).id);

    deepEqual(
      sentIds.sort(),
      getMessages(23)
        .map(({ id }) => id)
        .sort()
    );
  });

  it('assert :: no request for an empty list', async (t) => {
    const { batches } = mockBatches(t);

    await standardClient.sendMessages([]);

    equal(batches.length, 0);
  });

  it('assert :: a request carries at most 1 MiB of messages', async (t) => {
    const { batches } = mockBatches(t);

    // About 400 KB each: two fit in a request, a third doesn't.
    await standardClient.sendMessages(getMessages(5, 'x'.repeat(400000)));

    deepEqual(
      batches.map((entries) => entries.length),
      [2, 2, 1]
    );
  });

  it('assert :: a request takes messages up to exactly 1 MiB', async (t) => {
    const { batches } = mockBatches(t);

    Runtime.setScope({ traceId: 't'.repeat(36) });

    // SQS counts the body and the name, type and value of each attribute, here only the trace id.
    const overhead = JSON.stringify({ id: '0', group: 'group-0', text: '' }).length + 'EZ4.TRACE_ID'.length + 'String'.length + 36;
    const textSize = 1048576 / 2 - overhead;

    await standardClient.sendMessages(getMessages(2, 'x'.repeat(textSize)));
    await standardClient.sendMessages(getMessages(2, 'x'.repeat(textSize + 1)));

    deepEqual(
      batches.map((entries) => entries.length),
      [2, 1, 1]
    );
  });

  it('assert :: each message carries the trace and the delay', async (t) => {
    const { batches } = mockBatches(t);

    Runtime.setScope({ traceId: 'trace-batch' });

    await standardClient.sendMessages(getMessages(12), { delay: 30 });

    equal(batches.flat().length, 12);

    for (const entry of batches.flat()) {
      equal(entry.DelaySeconds, 30);
      deepEqual(entry.MessageAttributes?.['EZ4.TRACE_ID'], { StringValue: 'trace-batch', DataType: 'String' });
    }
  });

  it('assert :: a standard queue sends requests in parallel', async (t) => {
    const { getMaxInFlight } = mockBatches(t);

    await standardClient.sendMessages(getMessages(100));

    ok(getMaxInFlight() > 1);
  });

  it('assert :: a fifo queue sends one request at a time, in order, with group and deduplication ids', async (t) => {
    const { batches, getMaxInFlight } = mockBatches(t);

    await fifoClient.sendMessages(getMessages(25));

    equal(getMaxInFlight(), 1);

    const sentEntries = batches.flat();

    deepEqual(
      sentEntries.map(({ MessageBody }) => JSON.parse(MessageBody!).id),
      getMessages(25).map(({ id }) => id)
    );

    deepEqual(sentEntries[4].MessageGroupId, 'group-1');
    deepEqual(sentEntries[4].MessageDeduplicationId, '4');
  });

  it('assert :: an invalid message fails alone and the others are sent', async (t) => {
    const { batches } = mockBatches(t);

    const messages = getMessages(4);

    // Fails the schema at index 1 and the fifo group at index 2.
    messages[1] = { id: 1 as unknown as string, group: 'group-1' };
    messages[2] = { id: '2' };

    const failures = await getFailures(fifoClient.sendMessages(messages));

    deepEqual(
      failures.map(({ index }) => index),
      [1, 2]
    );

    deepEqual(
      batches.flat().map(({ MessageBody }) => JSON.parse(MessageBody!).id),
      ['0', '3']
    );
  });

  it('assert :: a message the queue refuses fails alone', async (t) => {
    mockBatches(t, async (entries) => {
      const [refused, ...accepted] = entries;

      return {
        ...(await acceptAll(accepted)),
        Failed: [{ Id: refused.Id!, SenderFault: true, Code: 'InvalidParameterValue', Message: 'Refused.' }]
      };
    });

    const failures = await getFailures(standardClient.sendMessages(getMessages(12)));

    deepEqual(
      failures.map(({ index }) => index).sort((a, b) => a - b),
      [0, 10]
    );

    ok(failures.every(({ reason }) => reason.includes('InvalidParameterValue')));
  });

  it('assert :: a message the queue failed on its side is sent again once', async (t) => {
    const attempts = new Map<string, number>();

    const { batches } = mockBatches(t, async (entries) => {
      const failed = entries.filter(({ Id }) => {
        const attempt = (attempts.get(Id!) ?? 0) + 1;

        attempts.set(Id!, attempt);

        // Message 3 fails once, message 5 fails every time.
        return (Id === '3' && attempt === 1) || Id === '5';
      });

      return {
        ...(await acceptAll(entries.filter((entry) => !failed.includes(entry)))),
        Failed: failed.map(({ Id }) => ({ Id: Id!, SenderFault: false, Code: 'InternalError', Message: 'Try again.' }))
      };
    });

    const failures = await getFailures(standardClient.sendMessages(getMessages(8)));

    deepEqual(failures, [{ index: 5, id: '5', reason: 'InternalError: Try again.' }]);

    equal(attempts.get('3'), 2);
    equal(attempts.get('5'), 2);
    equal(batches.length, 2);
  });

  it('assert :: a failed request fails only its own messages', async (t) => {
    let requests = 0;

    mockBatches(t, async (entries) => {
      if (++requests === 1) {
        throw new Error('Network down.');
      }

      return acceptAll(entries);
    });

    const failures = await getFailures(fifoClient.sendMessages(getMessages(15)));

    deepEqual(
      failures.map(({ index }) => index),
      [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]
    );

    ok(failures.every(({ reason }) => reason === 'Network down.'));
  });

  it('assert :: the error names how many failed and why', async (t) => {
    mockBatches(t, async () => {
      throw new Error('Network down.');
    });

    await rejects(standardClient.sendMessages(getMessages(3)), {
      name: 'SendMessagesError',
      message: `3 of 3 messages weren't sent to the queue: Network down.`
    });
  });
});
