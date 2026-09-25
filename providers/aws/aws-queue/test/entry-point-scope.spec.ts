import type { Context, SQSEvent, SQSMessageAttributes } from 'aws-lambda';

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

  const handleMessage = async (messageAttributes: SQSMessageAttributes) => {
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

    const event: SQSEvent = {
      Records: [
        {
          messageId: 'message-1',
          receiptHandle: 'receipt-1',
          body: '{}',
          attributes: {
            ApproximateReceiveCount: '1',
            SentTimestamp: '0',
            SenderId: 'sender-1',
            ApproximateFirstReceiveTimestamp: '0'
          },
          messageAttributes,
          md5OfBody: '99914b932bd37a50b983c5e7c90ae93b',
          eventSource: 'aws:sqs',
          eventSourceARN: 'arn:aws:sqs:us-east-1:000000000000:ez4-test-queue',
          awsRegion: 'us-east-1'
        }
      ]
    };

    await sqsEntryPoint(event, lambdaContext);

    return handledScope;
  };

  afterEach(() => {
    mock.restoreAll();
    Runtime.clearScope();

    for (const name of [
      '__EZ4_SCHEMA',
      '__EZ4_MAX_ATTEMPTS',
      '__EZ4_MIN_BACKOFF',
      '__EZ4_MAX_BACKOFF',
      '__EZ4_CONTEXT',
      'dispatch',
      'handle'
    ]) {
      Reflect.deleteProperty(globalThis, name);
    }
  });

  it('assert :: restore EZ4.SCOPE into the runtime scope', async () => {
    const handledScope = await handleMessage({
      ['EZ4.TRACE_ID']: { dataType: 'String', stringValue: 'trace-1' },
      ['EZ4.SCOPE']: { dataType: 'String', stringValue: scope }
    });

    deepEqual(handledScope, { traceId: 'trace-1', clientVersion: '1.2.3' });
  });

  it('assert :: restore only the trace id without EZ4.SCOPE', async () => {
    const handledScope = await handleMessage({
      ['EZ4.TRACE_ID']: { dataType: 'String', stringValue: 'trace-2' }
    });

    deepEqual(handledScope, { traceId: 'trace-2' });
  });
});
