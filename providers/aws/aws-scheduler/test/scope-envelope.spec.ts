import type { CreateScheduleCommand } from '@aws-sdk/client-scheduler';
import type { TestContext } from 'node:test';

import { afterEach, describe, it } from 'node:test';
import { deepEqual, equal } from 'node:assert/strict';

import { SchedulerClient } from '@aws-sdk/client-scheduler';
import { Client } from '@ez4/aws-scheduler/client';
import { SchemaType } from '@ez4/schema';
import { Runtime } from '@ez4/common';

describe('scheduler scope envelope', () => {
  const schedulerClient = Client.make(
    'arn:aws:iam::000000000000:role/ez4-test-role',
    'arn:aws:lambda:us-east-1:000000000000:function:ez4-test-function',
    undefined,
    {
      prefix: 'ez4-test',
      defaults: {},
      schema: {
        type: SchemaType.Object,
        properties: {
          foo: {
            type: SchemaType.String
          }
        }
      }
    }
  );

  const getEventPayload = async (t: TestContext) => {
    const send = t.mock.method(SchedulerClient.prototype, 'send', async () => ({}));

    await schedulerClient.createEvent('scope', { date: new Date(), event: { foo: 'bar' } });

    const [command] = send.mock.calls[0].arguments as unknown as [CreateScheduleCommand];

    return JSON.parse(command.input.Target?.Input ?? '');
  };

  afterEach(() => {
    Runtime.clearScope();
  });

  it('assert :: envelope carries the scope and it is restored', async (t) => {
    Runtime.setScope({ traceId: 'trace-1', clientVersion: '1.2.3' }, { clientVersion: 'x-client-version' });

    const payload = await getEventPayload(t);

    equal(payload.traceId, 'trace-1');
    equal(typeof payload.scope, 'string');
    deepEqual(payload.event, { foo: 'bar' });

    Runtime.setScope({ traceId: 'other' });
    Runtime.importScope(payload.traceId, payload.scope);

    deepEqual(Runtime.getScope(), { traceId: 'trace-1', clientVersion: '1.2.3' });
  });

  it('assert :: envelope without extra scope keeps the previous shape', async (t) => {
    Runtime.setScope({ traceId: 'trace-2' });

    deepEqual(await getEventPayload(t), {
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
