import type { TestContext } from 'node:test';

import { deepEqual, equal, ok, rejects } from 'node:assert/strict';
import { before, describe, it } from 'node:test';

import { MissingMessageGroupError } from '@ez4/queue/utils';
import { Logger } from '@ez4/logger';

import { getQueueImport, getQueueService, loadProbe, registerImport, startQueue, useQueueProbe } from './queue';
import { settle, useTestClock, waitFor } from './clock';
import { startTestServer } from './server';

const startOwner = async (t: TestContext) => {
  const owner = await startTestServer();

  t.after(() => owner.close());

  return owner;
};

describe('local queue import', () => {
  before(() => loadProbe());

  it('assert :: forward again until the owner answers', async (t) => {
    const clock = useTestClock(t, { date: false });
    const owner = await startOwner(t);

    owner.setStatus(503);

    const { client } = registerImport(t, getQueueImport('retryImport'), owner.host);

    await client.sendMessage({ id: 'a' });

    await waitFor(() => owner.requests.length === 1);

    await clock.advance(1000);
    await waitFor(() => owner.requests.length === 2);

    owner.setStatus(201);

    await clock.advance(2000);
    await waitFor(() => owner.requests.length === 3);

    await clock.advance(60_000);
    await settle();

    equal(owner.requests.length, 3);
    deepEqual(JSON.parse(owner.requests[2].body), { id: 'a' });
  });

  it('assert :: drop the message after about 30 seconds without the owner', async (t) => {
    const clock = useTestClock(t, { date: false });
    const owner = await startOwner(t);

    const errorLog = t.mock.method(Logger, 'error');

    owner.setStatus(503);

    const { client } = registerImport(t, getQueueImport('dropImport'), owner.host);

    await client.sendMessage({ id: 'a' });

    await waitFor(() => owner.requests.length === 1);

    // Tries again after 1, 2, 4, 8 and 16 seconds.
    for (const [delay, requests] of [
      [1000, 2],
      [2000, 3],
      [4000, 4],
      [8000, 5],
      [16000, 6]
    ]) {
      await clock.advance(delay);
      await waitFor(() => owner.requests.length === requests);
    }

    await clock.advance(120_000);
    await settle();

    equal(owner.requests.length, 6);

    ok(errorLog.mock.calls.some(({ arguments: [line] }) => `${line}`.includes('[ownerQueue]')));

    // A message sent after the drop starts over from the first delay.
    await client.sendMessage({ id: 'b' });
    await waitFor(() => owner.requests.length === 7);

    await clock.advance(1000);
    await waitFor(() => owner.requests.length === 8);

    equal(owner.requests.length, 8);
  });

  it('assert :: do not forward again a message the owner refuses', async (t) => {
    const clock = useTestClock(t, { date: false });
    const owner = await startOwner(t);

    const errorLog = t.mock.method(Logger, 'error');

    owner.setStatus(400);

    const { client } = registerImport(t, getQueueImport('refusedImport'), owner.host);

    await client.sendMessage({ id: 'a' });

    await waitFor(() => owner.requests.length === 1);

    await clock.advance(60_000);
    await settle();

    equal(owner.requests.length, 1);

    ok(errorLog.mock.calls.some(({ arguments: [line] }) => `${line}`.includes('Status 400.')));
  });

  it('assert :: forwarded messages keep their order', async (t) => {
    const clock = useTestClock(t, { date: false });
    const owner = await startOwner(t);

    owner.setStatus(503);

    const { client } = registerImport(t, getQueueImport('orderImport'), owner.host);

    await client.sendMessage({ id: 'a' });
    await client.sendMessage({ id: 'b' });
    await client.sendMessage({ id: 'c' });

    await waitFor(() => owner.requests.length === 1);
    await settle();

    owner.setStatus(201);

    await clock.advance(1000);
    await waitFor(() => owner.requests.length === 4);

    deepEqual(
      owner.requests.slice(1).map(({ body }) => JSON.parse(body).id),
      ['a', 'b', 'c']
    );
  });

  it('assert :: a stubbed fetch does not take the emulator traffic', async (t) => {
    const owner = await startOwner(t);

    const fetchStub = t.mock.method(globalThis, 'fetch', async () => new Response(null, { status: 201 }));

    const { client } = registerImport(t, getQueueImport('fetchImport'), owner.host);

    await client.sendMessage({ id: 'a' });

    await waitFor(() => owner.requests.length === 1);

    equal(owner.requests.length, 1);
    equal(fetchStub.mock.callCount(), 0);
  });

  it('assert :: shutdown drops the messages waiting for the owner', async (t) => {
    const clock = useTestClock(t, { date: false });
    const owner = await startOwner(t);

    owner.setStatus(503);

    const { emulator, client } = registerImport(t, getQueueImport('shutdownImport'), owner.host);

    await client.sendMessage({ id: 'a' });

    await waitFor(() => owner.requests.length === 1);

    await clock.advance(1000);
    await waitFor(() => owner.requests.length === 2);

    await emulator.shutdownHandler?.();

    equal(clock.pendingTimers(), 0);

    await clock.advance(60_000);
    await settle();

    equal(owner.requests.length, 2);
  });

  it('assert :: forward the delay of the message', async (t) => {
    const owner = await startOwner(t);

    const { client } = registerImport(t, getQueueImport('delayImport'), owner.host);

    await client.sendMessage({ id: 'a' }, { delay: 5 });

    await waitFor(() => owner.requests.length === 1);

    equal(owner.requests[0]?.headers['x-ez4-delay'], '5');
  });

  it('assert :: the owner delays a forwarded message', async (t) => {
    const clock = useTestClock(t);
    const probe = useQueueProbe(t);

    const { emulator } = await startQueue(t, getQueueService('ownerDelayQueue'));

    const response = await emulator.requestHandler({
      method: 'POST',
      path: '/',
      query: {},
      headers: {
        'x-ez4-delay': '5'
      },
      body: Buffer.from(JSON.stringify({ id: 'a' }))
    });

    equal(response?.status, 201);

    await clock.advance(4999);

    equal(probe.requests.length, 0);

    await clock.advance(1);

    equal(probe.requests.length, 1);
  });

  it('assert :: the owner answers 400 for a message the queue refuses', async (t) => {
    const { emulator } = await startQueue(
      t,
      getQueueService('ownerRefusalQueue', {
        fifoMode: {
          groupId: 'group'
        }
      })
    );

    const response = await emulator.requestHandler({
      method: 'POST',
      path: '/',
      query: {},
      headers: {},
      body: Buffer.from(JSON.stringify({ id: 'a' }))
    });

    equal(response?.status, 400);
  });

  it('assert :: the import client runs the checks of the real client', async (t) => {
    const owner = await startOwner(t);

    const { client } = registerImport(
      t,
      getQueueImport('checkedImport', {
        fifoMode: {
          groupId: 'group'
        }
      }),
      owner.host
    );

    await rejects(() => client.sendMessage({ id: 'a' }), MissingMessageGroupError);

    await rejects(() => client.sendMessage({ id: 'x'.repeat(1048576), group: 'g' }), {
      name: 'InvalidParameterValue'
    });

    await settle();

    equal(owner.requests.length, 0);
  });
});
