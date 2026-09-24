import type { Context } from 'aws-lambda';
import type { AnyObject } from '@ez4/utils';

import { afterEach, describe, it } from 'node:test';
import { deepEqual } from 'node:assert/strict';

import { Runtime } from '@ez4/common';

import { eventEntryPoint } from '../lib/event';

describe('scheduler entry point scope', () => {
  const lambdaContext = {
    awsRequestId: 'test-request-id',
    getRemainingTimeInMillis: () => 5000
  } as Context;

  const scope = JSON.stringify({
    values: { clientVersion: '1.2.3' },
    headers: { clientVersion: 'x-client-version' }
  });

  const handleEvent = async (payload: AnyObject) => {
    let handledScope: Runtime.Scope | undefined;

    Object.assign(globalThis, {
      __EZ4_SCHEMA: null,
      __EZ4_CONTEXT: {},
      dispatch: async () => {},
      handle: async () => {
        handledScope = Runtime.getScope();
      }
    });

    Runtime.setScope({ traceId: 'stale', clientVersion: 'stale' }, { clientVersion: 'x-client-version' });

    await eventEntryPoint(payload, lambdaContext);

    return handledScope;
  };

  afterEach(() => {
    Runtime.clearScope();
  });

  it('assert :: restore the envelope scope into the runtime scope', async () => {
    const handledScope = await handleEvent({ traceId: 'trace-1', scope, event: null });

    deepEqual(handledScope, { traceId: 'trace-1', clientVersion: '1.2.3' });
  });

  it('assert :: restore only the trace id without envelope scope', async () => {
    const handledScope = await handleEvent({ traceId: 'trace-2', event: null });

    deepEqual(handledScope, { traceId: 'trace-2' });
  });
});
