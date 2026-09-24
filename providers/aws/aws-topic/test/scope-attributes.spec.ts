import type { SNSMessageAttributes } from 'aws-lambda';

import { describe, it } from 'node:test';
import { deepEqual, equal, ok } from 'node:assert/strict';

import { getMessageAttributes } from '@ez4/aws-topic/client';
import { Runtime } from '@ez4/common';

describe('topic scope attributes', () => {
  it('assert :: scope travels in EZ4.SCOPE and is restored', () => {
    Runtime.setScope({ traceId: 'trace-1', sessionId: 'session-1' }, { sessionId: 'x-posthog-session-id' });

    const attributes = getMessageAttributes();

    deepEqual(attributes['EZ4.TRACE_ID'], { StringValue: 'trace-1', DataType: 'String' });
    equal(attributes['EZ4.SCOPE']?.DataType, 'String');
    ok(attributes['EZ4.SCOPE']?.StringValue);

    Runtime.setScope({ traceId: 'other' });
    Runtime.importScope(attributes['EZ4.TRACE_ID'].StringValue!, attributes['EZ4.SCOPE']?.StringValue);

    deepEqual(Runtime.getScope(), { traceId: 'trace-1', sessionId: 'session-1' });
  });

  it('assert :: no EZ4.SCOPE without extra scope values', () => {
    Runtime.setScope({ traceId: 'trace-2' });

    deepEqual(Object.keys(getMessageAttributes()), ['EZ4.TRACE_ID']);
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
