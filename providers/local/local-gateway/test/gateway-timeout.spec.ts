import type { HttpService } from '@ez4/gateway/library';
import type { TestContext } from 'node:test';

import { deepEqual, equal, ok } from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import { Logger } from '@ez4/logger';

import { registerHttpLocalService } from '../src/provider/http/local';
import { emulateContext, getHandler, getRequest, serveOptions } from './common/emulator';

type TimeoutOptions = {
  routeTimeout?: number;
  defaultTimeout?: number;
  authorizer?: boolean;
};

// What API Gateway answers by itself when the Lambda times out.
const timeoutResponse = {
  status: 500,
  headers: {
    ['content-type']: 'application/json'
  },
  body: '{"message":"Internal Server Error"}'
};

const getTimeoutService = ({ routeTimeout, defaultTimeout, authorizer }: TimeoutOptions) => {
  return {
    name: 'timeoutApi',
    services: {},
    variables: {},
    defaults: {
      listener: getHandler('timeout-probe.ts', 'recordEvent'),
      timeout: defaultTimeout
    },
    routes: [
      {
        path: 'GET /slow',
        timeout: routeTimeout,
        ...(authorizer && {
          authorizer: getHandler('timeout-probe.ts', 'hangRequest')
        }),
        handler: {
          ...getHandler('timeout-probe.ts', authorizer ? 'recordHandler' : 'hangRequest'),
          response: {
            status: 204
          }
        }
      }
    ]
  } as unknown as HttpService;
};

const startProbe = () => {
  const events: string[] = [];

  let release: (response: unknown) => void = () => {};

  const started = new Promise<void>((resolve) => {
    globalThis.timeoutProbe = {
      events,
      started: (resume) => {
        release = resume;
        resolve();
      }
    };
  });

  return {
    events,
    started,
    release: (response: unknown) => release(response)
  };
};

const flushPending = () => {
  return new Promise((resolve) => setImmediate(resolve));
};

const sendRequest = (options: TimeoutOptions) => {
  const api = registerHttpLocalService(getTimeoutService(options), serveOptions, emulateContext);

  const response = api.requestHandler(getRequest('GET', '/slow', { 'x-trace-id': 'trace-slow' }));

  const state = {
    settled: false
  };

  response.then(() => {
    state.settled = true;
  });

  return { response, state };
};

const assertDeadline = async (t: TestContext, options: TimeoutOptions, milliseconds: number) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  t.mock.method(Logger, 'warn', () => {});

  const probe = startProbe();
  const { response, state } = sendRequest(options);

  await probe.started;

  t.mock.timers.tick(milliseconds - 1);
  await flushPending();

  equal(state.settled, false, 'answered before the deadline');

  t.mock.timers.tick(1);
  await flushPending();

  ok(state.settled, 'not answered at the deadline');

  deepEqual(await response, timeoutResponse);
};

describe('local gateway timeout', () => {
  afterEach(() => {
    globalThis.timeoutProbe = undefined;
  });

  it('assert :: route answers as api gateway when its lambda times out', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });

    const warn = t.mock.method(Logger, 'warn', () => {});

    const probe = startProbe();
    const { response, state } = sendRequest({ routeTimeout: 7 });

    await probe.started;

    // The Lambda gets 6 seconds, and the runtime emits the timeout event a second before its deadline.
    t.mock.timers.tick(4_999);
    deepEqual(probe.events, ['begin', 'ready']);

    t.mock.timers.tick(1);
    deepEqual(probe.events, ['begin', 'ready', 'timeout']);

    t.mock.timers.tick(1_000);
    await flushPending();

    ok(state.settled, 'not answered at the deadline');

    deepEqual(await response, timeoutResponse);

    // The handler keeps running, and what it returns later goes nowhere.
    probe.release({ status: 204 });
    await flushPending();

    deepEqual(probe.events, ['begin', 'ready', 'timeout', 'done', 'end']);

    ok(warn.mock.calls.some(({ arguments: [message] }) => message?.includes('discarded')));
  });

  it('assert :: authorizer answers as api gateway when its lambda times out', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    t.mock.method(Logger, 'warn', () => {});

    const probe = startProbe();
    const { response, state } = sendRequest({ authorizer: true });

    await probe.started;

    // The authorizer takes the route timeout (30 seconds by default), so its Lambda gets 29.
    t.mock.timers.tick(27_999);
    deepEqual(probe.events, ['begin', 'ready']);

    t.mock.timers.tick(1);
    deepEqual(probe.events, ['begin', 'ready', 'timeout']);

    t.mock.timers.tick(1_000);
    await flushPending();

    ok(state.settled, 'not answered at the deadline');

    deepEqual(await response, timeoutResponse);

    ok(!probe.events.includes('handler'));
  });

  it('assert :: lambda gets five seconds at least', async (t) => {
    await assertDeadline(t, { routeTimeout: 3 }, 5_000);
  });

  it('assert :: lambda takes the default timeout', async (t) => {
    await assertDeadline(t, { defaultTimeout: 12 }, 11_000);
  });

  it('assert :: route timeout wins over the default one', async (t) => {
    await assertDeadline(t, { routeTimeout: 8, defaultTimeout: 12 }, 7_000);
  });
});
