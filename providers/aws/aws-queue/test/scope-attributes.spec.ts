import type { SendMessageCommand } from '@aws-sdk/client-sqs';
import type { TestContext } from 'node:test';

import { afterEach, describe, it } from 'node:test';
import { deepEqual, equal, ok } from 'node:assert/strict';

import { SQSClient } from '@aws-sdk/client-sqs';
import { Client } from '@ez4/aws-queue/client';
import { SchemaType } from '@ez4/schema';
import { Runtime } from '@ez4/common';

describe('queue scope attributes', () => {
  const queueClient = Client.make('https://sqs.test/ez4-test-queue-scope', {
    type: SchemaType.Object,
    properties: {}
  });

  const getMessageAttributes = async (t: TestContext) => {
    const send = t.mock.method(SQSClient.prototype, 'send', async () => ({}));

    await queueClient.sendMessage({});

    const [command] = send.mock.calls[0].arguments as unknown as [SendMessageCommand];

    return command.input.MessageAttributes ?? {};
  };

  afterEach(() => {
    Runtime.clearScope();
  });

  it('assert :: scope travels in EZ4.SCOPE and is restored', async (t) => {
    Runtime.setScope({ traceId: 'trace-1', clientVersion: '1.2.3' }, { clientVersion: 'x-client-version' });

    const attributes = await getMessageAttributes(t);

    deepEqual(attributes['EZ4.TRACE_ID'], { StringValue: 'trace-1', DataType: 'String' });
    equal(attributes['EZ4.SCOPE']?.DataType, 'String');
    ok(attributes['EZ4.SCOPE']?.StringValue);

    Runtime.setScope({ traceId: 'other' });
    Runtime.importScope(attributes['EZ4.TRACE_ID'].StringValue!, attributes['EZ4.SCOPE']?.StringValue);

    deepEqual(Runtime.getScope(), { traceId: 'trace-1', clientVersion: '1.2.3' });
  });

  it('assert :: no EZ4.SCOPE without extra scope values', async (t) => {
    Runtime.setScope({ traceId: 'trace-2' });

    const attributes = await getMessageAttributes(t);

    deepEqual(Object.keys(attributes), ['EZ4.TRACE_ID']);
  });

  it('assert :: a message without EZ4.SCOPE restores only the traceId', () => {
    Runtime.setScope({ traceId: 'other', clientVersion: 'stale' }, { clientVersion: 'x-client-version' });

    const legacyAttributes: Record<string, { stringValue?: string }> = {
      ['EZ4.TRACE_ID']: { stringValue: 'trace-3' }
    };

    Runtime.importScope(legacyAttributes['EZ4.TRACE_ID'].stringValue!, legacyAttributes['EZ4.SCOPE']?.stringValue);

    deepEqual(Runtime.getScope(), { traceId: 'trace-3' });
  });

  it('assert :: at most two ez4 attributes are sent', async (t) => {
    Runtime.setScope({ traceId: 'trace-4', a: '1', b: '2', c: '3' }, { a: 'x-a', b: 'x-b', c: 'x-c' });

    deepEqual(Object.keys(await getMessageAttributes(t)), ['EZ4.TRACE_ID', 'EZ4.SCOPE']);
  });
});
