import type { Context, SQSEvent } from 'aws-lambda';

import { afterEach, describe, it, mock } from 'node:test';
import { deepEqual } from 'node:assert/strict';

import { SQSClient } from '@aws-sdk/client-sqs';
import { SchemaType } from '@ez4/schema';
import { Runtime } from '@ez4/common';

import { sqsEntryPoint } from '../lib/message';

describe('queue entry point scope', () => {
  const lambdaContext = {
    awsRequestId: 'test-request-id',
    getRemainingTimeInMillis: () => 5000
  } as Context;

  const scope = JSON.stringify({
    values: { clientVersion: '1.2.3' },
    headers: { clientVersion: 'x-client-version' }
  });

  const handleMessage = async (messageAttributes: Record<string, { stringValue: string }>) => {
    let handledScope: Runtime.Scope | undefined;

    Object.assign(globalThis, {
      __EZ4_SCHEMA: { type: SchemaType.Object, properties: {} },
      __EZ4_MAX_ATTEMPTS: 1,
      __EZ4_MIN_BACKOFF: 0,
      __EZ4_MAX_BACKOFF: 0,
      __EZ4_CONTEXT: {},
      dispatch: async () => {},
      handle: async () => {
        handledScope = Runtime.getScope();
      }
    });

    mock.method(SQSClient.prototype, 'send', async () => ({}));

    Runtime.setScope({ traceId: 'stale', clientVersion: 'stale' }, { clientVersion: 'x-client-version' });

    const event = {
      Records: [
        {
          messageId: 'message-1',
          receiptHandle: 'receipt-1',
          body: '{}',
          attributes: { ApproximateReceiveCount: '1' },
          eventSourceARN: 'arn:aws:sqs:us-east-1:000000000000:ez4-test-queue',
          messageAttributes
        }
      ]
    };

    await sqsEntryPoint(event as unknown as SQSEvent, lambdaContext);

    return handledScope;
  };

  afterEach(() => {
    mock.restoreAll();
    Runtime.clearScope();
  });

  it('assert :: restore EZ4.SCOPE into the runtime scope', async () => {
    const handledScope = await handleMessage({
      ['EZ4.TRACE_ID']: { stringValue: 'trace-1' },
      ['EZ4.SCOPE']: { stringValue: scope }
    });

    deepEqual(handledScope, { traceId: 'trace-1', clientVersion: '1.2.3' });
  });

  it('assert :: restore only the trace id without EZ4.SCOPE', async () => {
    const handledScope = await handleMessage({
      ['EZ4.TRACE_ID']: { stringValue: 'trace-2' }
    });

    deepEqual(handledScope, { traceId: 'trace-2' });
  });
});
