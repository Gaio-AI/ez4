import type { Context, S3Event } from 'aws-lambda';
import type { Bucket } from '@ez4/storage';

import { describe, it, before, beforeEach, after } from 'node:test';
import { deepEqual, rejects } from 'node:assert/strict';

import { ServiceEventType } from '@ez4/common';

import { s3EntryPoint } from '../lib/event';

const dispatchedEvents: ServiceEventType[] = [];

let failingHandler = false;

// Stand-ins for what the bundler defines around lib/event.ts in a deployed function.
const runtime = globalThis as Record<string, unknown>;

const runtimeGlobals = {
  __EZ4_CONTEXT: {},
  handle: async (_request: Bucket.Request) => {
    if (failingHandler) {
      throw new Error('Handler failed.');
    }
  },
  dispatch: async (event: { type: ServiceEventType }) => {
    dispatchedEvents.push(event.type);
  }
};

const context = {
  awsRequestId: 'request-id',
  getRemainingTimeInMillis: () => 30_000
} as Context;

const makeEvent = (objectKey: string) => {
  return {
    Records: [
      {
        eventName: 'ObjectCreated:Put',
        s3: {
          bucket: {
            name: 'test-bucket'
          },
          object: {
            key: objectKey,
            size: 1
          }
        }
      }
    ]
  } as unknown as S3Event;
};

describe('aws bucket event handler', () => {
  before(() => {
    Object.assign(runtime, runtimeGlobals);
  });

  beforeEach(() => {
    dispatchedEvents.length = 0;
    failingHandler = false;
  });

  after(() => {
    for (const name of Object.keys(runtimeGlobals)) {
      delete runtime[name];
    }
  });

  it('assert :: a handled event completes the invocation', async () => {
    await s3EntryPoint(makeEvent('file.txt'), context);

    deepEqual(dispatchedEvents, [ServiceEventType.Begin, ServiceEventType.Ready, ServiceEventType.Done, ServiceEventType.End]);
  });

  it('assert :: a handler error fails the invocation', async () => {
    failingHandler = true;

    await rejects(() => s3EntryPoint(makeEvent('file.txt'), context), /Handler failed/);

    deepEqual(dispatchedEvents, [ServiceEventType.Begin, ServiceEventType.Ready, ServiceEventType.Error, ServiceEventType.End]);
  });
});
