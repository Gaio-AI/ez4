import type { Context, SNSEvent } from 'aws-lambda';

import { afterEach, describe, it } from 'node:test';
import { deepEqual } from 'node:assert/strict';

import { SchemaType } from '@ez4/schema';
import { Runtime } from '@ez4/common';

import { snsEntryPoint } from '../lib/event';

describe('topic entry point scope', () => {
  const lambdaContext = {
    awsRequestId: 'test-request-id',
    getRemainingTimeInMillis: () => 5000
  } as Context;

  const scope = JSON.stringify({
    values: { clientVersion: '1.2.3' },
    headers: { clientVersion: 'x-client-version' }
  });

  const handleEvent = async (messageAttributes: Record<string, { Type: string; Value: string }>) => {
    let handledScope: Runtime.Scope | undefined;

    Object.assign(globalThis, {
      __EZ4_SCHEMA: { type: SchemaType.Object, properties: {} },
      __EZ4_CONTEXT: {},
      dispatch: async () => {},
      handle: async () => {
        handledScope = Runtime.getScope();
      }
    });

    Runtime.setScope({ traceId: 'stale', clientVersion: 'stale' }, { clientVersion: 'x-client-version' });

    const event = {
      Records: [
        {
          Sns: {
            Message: '{}',
            MessageAttributes: messageAttributes
          }
        }
      ]
    };

    await snsEntryPoint(event as unknown as SNSEvent, lambdaContext);

    return handledScope;
  };

  afterEach(() => {
    Runtime.clearScope();
  });

  it('assert :: restore EZ4.SCOPE into the runtime scope', async () => {
    const handledScope = await handleEvent({
      ['EZ4.TRACE_ID']: { Type: 'String', Value: 'trace-1' },
      ['EZ4.SCOPE']: { Type: 'String', Value: scope }
    });

    deepEqual(handledScope, { traceId: 'trace-1', clientVersion: '1.2.3' });
  });

  it('assert :: restore only the trace id without EZ4.SCOPE', async () => {
    const handledScope = await handleEvent({
      ['EZ4.TRACE_ID']: { Type: 'String', Value: 'trace-2' }
    });

    deepEqual(handledScope, { traceId: 'trace-2' });
  });
});
