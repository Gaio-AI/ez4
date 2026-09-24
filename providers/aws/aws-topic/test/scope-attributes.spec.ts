import type { PublishCommand } from '@aws-sdk/client-sns';
import type { SNSMessageAttributes } from 'aws-lambda';
import type { TestContext } from 'node:test';

import { afterEach, describe, it } from 'node:test';
import { deepEqual, equal, ok } from 'node:assert/strict';

import { SNSClient } from '@aws-sdk/client-sns';
import { Client } from '@ez4/aws-topic/client';
import { SchemaType } from '@ez4/schema';
import { Runtime } from '@ez4/common';

describe('topic scope attributes', () => {
  const topicClient = Client.make('arn:aws:sns:us-east-1:000000000000:ez4-test-topic-scope', {
    type: SchemaType.Object,
    properties: {}
  });

  const getMessageAttributes = async (t: TestContext) => {
    const send = t.mock.method(SNSClient.prototype, 'send', async () => ({}));

    await topicClient.publishEvent({});

    const [command] = send.mock.calls[0].arguments as unknown as [PublishCommand];

    return command.input.MessageAttributes ?? {};
  };

  afterEach(() => {
    Runtime.clearScope();
  });

  it('assert :: scope travels in EZ4.SCOPE and is restored', async (t) => {
    Runtime.setScope({ traceId: 'trace-1', sessionId: 'session-1' }, { sessionId: 'x-posthog-session-id' });

    const attributes = await getMessageAttributes(t);

    deepEqual(attributes['EZ4.TRACE_ID'], { StringValue: 'trace-1', DataType: 'String' });
    equal(attributes['EZ4.SCOPE']?.DataType, 'String');
    ok(attributes['EZ4.SCOPE']?.StringValue);

    Runtime.setScope({ traceId: 'other' });
    Runtime.importScope(attributes['EZ4.TRACE_ID'].StringValue!, attributes['EZ4.SCOPE']?.StringValue);

    deepEqual(Runtime.getScope(), { traceId: 'trace-1', sessionId: 'session-1' });
  });

  it('assert :: no EZ4.SCOPE without extra scope values', async (t) => {
    Runtime.setScope({ traceId: 'trace-2' });

    deepEqual(Object.keys(await getMessageAttributes(t)), ['EZ4.TRACE_ID']);
  });

  it('assert :: an event without EZ4.SCOPE restores only the traceId', () => {
    Runtime.setScope({ traceId: 'other', sessionId: 'stale' }, { sessionId: 'x-posthog-session-id' });

    const legacyAttributes: SNSMessageAttributes = {
      ['EZ4.TRACE_ID']: { Type: 'String', Value: 'trace-3' }
    };

    Runtime.importScope(legacyAttributes['EZ4.TRACE_ID'].Value, legacyAttributes['EZ4.SCOPE']?.Value);

    deepEqual(Runtime.getScope(), { traceId: 'trace-3' });
  });
});
