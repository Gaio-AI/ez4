import type { Context, SNSEvent } from 'aws-lambda';
import type { ObjectSchema } from '@ez4/schema';
import type { Topic } from '@ez4/topic';

import { describe, it, before, beforeEach, after } from 'node:test';
import { deepEqual, rejects } from 'node:assert/strict';

import { ServiceEventType } from '@ez4/common';
import { SchemaType } from '@ez4/schema';

import { snsEntryPoint } from '../lib/event';

const eventSchema: ObjectSchema = {
  type: SchemaType.Object,
  properties: {
    id: {
      type: SchemaType.String
    }
  }
};

const dispatchedEvents: ServiceEventType[] = [];

let failingHandler = false;

// Stand-ins for what the bundler defines around lib/event.ts in a deployed function.
const runtime = globalThis as Record<string, unknown>;

const runtimeGlobals = {
  __EZ4_SCHEMA: eventSchema,
  __EZ4_CONTEXT: {},
  handle: async (_request: Topic.Incoming<{ id: string }>) => {
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

const makeEvent = (id: string) => {
  return {
    Records: [
      {
        Sns: {
          Message: JSON.stringify({ id }),
          MessageAttributes: {}
        }
      }
    ]
  } as unknown as SNSEvent;
};

describe('aws topic event handler', () => {
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
    await snsEntryPoint(makeEvent('a'), context);

    deepEqual(dispatchedEvents, [ServiceEventType.Begin, ServiceEventType.Ready, ServiceEventType.Done, ServiceEventType.End]);
  });

  it('assert :: a handler error fails the invocation', async () => {
    failingHandler = true;

    await rejects(() => snsEntryPoint(makeEvent('a'), context), /Handler failed/);

    deepEqual(dispatchedEvents, [ServiceEventType.Begin, ServiceEventType.Ready, ServiceEventType.Error, ServiceEventType.End]);
  });
});
