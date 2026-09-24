import { describe, it } from 'node:test';
import { deepEqual, equal, ok } from 'node:assert/strict';

import { getMessageAttributes } from '@ez4/aws-queue/client';
import { Runtime } from '@ez4/common';

describe('queue scope attributes', () => {
  it('assert :: scope travels in EZ4.SCOPE and is restored', () => {
    Runtime.setScope({ traceId: 'trace-1', clientVersion: '1.2.3' }, { clientVersion: 'x-client-version' });

    const attributes = getMessageAttributes();

    deepEqual(attributes['EZ4.TRACE_ID'], { StringValue: 'trace-1', DataType: 'String' });
    equal(attributes['EZ4.SCOPE']?.DataType, 'String');
    ok(attributes['EZ4.SCOPE']?.StringValue);

    Runtime.setScope({ traceId: 'other' });
    Runtime.importScope(attributes['EZ4.TRACE_ID'].StringValue!, attributes['EZ4.SCOPE']?.StringValue);

    deepEqual(Runtime.getScope(), { traceId: 'trace-1', clientVersion: '1.2.3' });
  });

  it('assert :: no EZ4.SCOPE without extra scope values', () => {
    Runtime.setScope({ traceId: 'trace-2' });

    const attributes = getMessageAttributes();

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

  it('assert :: at most two ez4 attributes are sent', () => {
    Runtime.setScope({ traceId: 'trace-4', a: '1', b: '2', c: '3' }, { a: 'x-a', b: 'x-b', c: 'x-c' });

    deepEqual(Object.keys(getMessageAttributes()), ['EZ4.TRACE_ID', 'EZ4.SCOPE']);
  });
});
