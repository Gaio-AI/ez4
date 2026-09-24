import { describe, it } from 'node:test';
import { deepEqual, equal } from 'node:assert/strict';

import { Client } from '@ez4/aws-scheduler/client';
import { Runtime } from '@ez4/common';

describe('scheduler scope envelope', () => {
  it('assert :: envelope carries the scope and it is restored', () => {
    Runtime.setScope({ traceId: 'trace-1', clientVersion: '1.2.3' }, { clientVersion: 'x-client-version' });

    const payload = JSON.parse(Client.prepareEventData({ foo: 'bar' }));

    equal(payload.traceId, 'trace-1');
    equal(typeof payload.scope, 'string');
    deepEqual(payload.event, { foo: 'bar' });

    Runtime.setScope({ traceId: 'other' });
    Runtime.importScope(payload.traceId, payload.scope);

    deepEqual(Runtime.getScope(), { traceId: 'trace-1', clientVersion: '1.2.3' });
  });

  it('assert :: envelope without extra scope keeps the previous shape', () => {
    Runtime.setScope({ traceId: 'trace-2' });

    deepEqual(JSON.parse(Client.prepareEventData({ foo: 'bar' })), {
      traceId: 'trace-2',
      event: { foo: 'bar' }
    });
  });

  it('assert :: an envelope without scope restores only the traceId', () => {
    Runtime.setScope({ traceId: 'other', clientVersion: 'stale' }, { clientVersion: 'x-client-version' });

    const legacyPayload = JSON.parse('{"traceId":"trace-3","event":{"foo":"bar"}}');

    Runtime.importScope(legacyPayload.traceId, legacyPayload.scope);

    deepEqual(Runtime.getScope(), { traceId: 'trace-3' });
  });
});
