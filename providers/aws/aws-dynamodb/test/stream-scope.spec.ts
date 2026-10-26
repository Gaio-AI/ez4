import type { Context, DynamoDBStreamEvent } from 'aws-lambda';

import { afterEach, describe, it } from 'node:test';
import { deepEqual, equal, notEqual, ok } from 'node:assert/strict';

import { ServiceEventType, Runtime } from '@ez4/common';
import { SchemaType } from '@ez4/schema';

import { dbStreamEntryPoint } from '../lib/stream';

type DispatchedEvent = {
  type: ServiceEventType;
  request: Record<string, unknown>;
};

describe('dynamodb stream entry point scope', () => {
  const lambdaContext = {
    awsRequestId: 'test-request-id',
    getRemainingTimeInMillis: () => 5000
  } as Context;

  afterEach(() => {
    Runtime.clearScope();

    for (const name of ['__EZ4_SCHEMA', '__EZ4_CONTEXT', 'dispatch', 'handle']) {
      Reflect.deleteProperty(globalThis, name);
    }
  });

  it('assert :: a record that fails validation is reported in its own scope, without the previous record', async () => {
    const handledTraceIds: string[] = [];

    let errorRequest: Record<string, unknown> | undefined;
    let errorTraceId: string | undefined;

    Object.assign(globalThis, {
      __EZ4_SCHEMA: {
        type: SchemaType.Object,
        properties: {
          id: { type: SchemaType.String }
        }
      },
      __EZ4_CONTEXT: {},
      dispatch: async (event: DispatchedEvent) => {
        if (event.type === ServiceEventType.Error) {
          errorRequest = event.request;
          errorTraceId = Runtime.getScope()?.traceId;
        }
      },
      handle: async () => {
        const traceId = Runtime.getScope()?.traceId;

        if (traceId) {
          handledTraceIds.push(traceId);
        }
      }
    });

    const event = {
      Records: [
        { eventName: 'INSERT', dynamodb: { NewImage: { id: { S: 'valid' } } } },
        { eventName: 'INSERT', dynamodb: { NewImage: { id: { N: '1' } } } }
      ]
    } as unknown as DynamoDBStreamEvent;

    await dbStreamEntryPoint(event, lambdaContext);

    equal(handledTraceIds.length, 1);

    ok(errorTraceId);
    notEqual(errorTraceId, handledTraceIds[0]);

    deepEqual(errorRequest, { requestId: 'test-request-id' });
  });
});
