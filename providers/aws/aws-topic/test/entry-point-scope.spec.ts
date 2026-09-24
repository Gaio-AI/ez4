import type { Context, SNSEvent, SNSMessageAttributes } from 'aws-lambda';

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

  const handleEvent = async (messageAttributes: SNSMessageAttributes) => {
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

    const topicArn = 'arn:aws:sns:us-east-1:000000000000:ez4-test-topic';

    const event: SNSEvent = {
      Records: [
        {
          EventVersion: '1.0',
          EventSubscriptionArn: `${topicArn}:subscription-1`,
          EventSource: 'aws:sns',
          Sns: {
            SignatureVersion: '1',
            Timestamp: '1970-01-01T00:00:00.000Z',
            Signature: 'signature',
            SigningCertUrl: 'https://sns.us-east-1.amazonaws.com/cert.pem',
            MessageId: 'message-1',
            Message: '{}',
            MessageAttributes: messageAttributes,
            Type: 'Notification',
            UnsubscribeUrl: 'https://sns.us-east-1.amazonaws.com/unsubscribe',
            TopicArn: topicArn
          }
        }
      ]
    };

    await snsEntryPoint(event, lambdaContext);

    return handledScope;
  };

  afterEach(() => {
    Runtime.clearScope();

    for (const name of ['__EZ4_SCHEMA', '__EZ4_CONTEXT', 'dispatch', 'handle']) {
      Reflect.deleteProperty(globalThis, name);
    }
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
