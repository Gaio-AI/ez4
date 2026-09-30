import type { EmulatorConnection, ServeOptions } from '@ez4/project/library';
import type { WsService } from '@ez4/gateway/library';
import type { TestContext } from 'node:test';

import { deepEqual, equal } from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';

import { registerWsLocalService } from '../src/provider/ws/local';
import { emulateContext, getHandler, serveOptions } from './common/emulator';

const MINUTE = 60_000;

const lifecycleService = {
  name: 'lifecycleWs',
  services: {},
  variables: {},
  schema: {
    type: 'object',
    properties: {}
  },
  connect: {
    handler: getHandler('ws-probe.ts', 'recordConnect')
  },
  disconnect: {
    handler: getHandler('ws-probe.ts', 'recordDisconnect')
  },
  message: {
    handler: getHandler('ws-probe.ts', 'recordMessage')
  }
} as unknown as WsService;

const flushPending = () => {
  return new Promise((resolve) => setImmediate(resolve));
};

// Mocks the timers and opens a connection that closes as the serve's does: the socket goes, then the disconnect runs.
const openConnection = async (t: TestContext, options: ServeOptions = serveOptions) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });

  const ws = registerWsLocalService(lifecycleService, options, emulateContext);

  let live = true;

  const connection: EmulatorConnection = {
    id: 'connection-1',
    get live() {
      return live;
    },
    write: () => {},
    close: () => {
      live = false;

      return ws.disconnectHandler({
        connection,
        headers: {}
      });
    }
  };

  await ws.connectHandler({
    connection,
    headers: {},
    query: {}
  });

  const sendMessage = () => {
    return ws.messageHandler({
      connection,
      body: Buffer.from('{}')
    });
  };

  const passTime = async (milliseconds: number) => {
    t.mock.timers.tick(milliseconds);
    await flushPending();
  };

  return { connection, sendMessage, passTime };
};

describe('local ws lifecycle', () => {
  beforeEach(() => {
    globalThis.wsEvents = [];
  });

  afterEach(() => {
    globalThis.wsEvents = undefined;
  });

  it('assert :: close a connection idle for 10 minutes', async (t) => {
    const { connection, passTime } = await openConnection(t);

    await passTime(10 * MINUTE - 1);

    equal(connection.live, true);

    await passTime(1);

    equal(connection.live, false);

    deepEqual(globalThis.wsEvents, ['connect connection-1', 'disconnect connection-1']);
  });

  it('assert :: a message restarts the idle time', async (t) => {
    const { connection, sendMessage, passTime } = await openConnection(t);

    await passTime(8 * MINUTE);
    await sendMessage();
    await passTime(10 * MINUTE - 1);

    equal(connection.live, true);

    await passTime(1);

    equal(connection.live, false);
  });

  it('assert :: close a connection open for 2 hours', async (t) => {
    const { connection, sendMessage, passTime } = await openConnection(t);

    for (let minutes = 0; minutes < 115; minutes += 5) {
      await passTime(5 * MINUTE);
      await sendMessage();
    }

    await passTime(5 * MINUTE - 1);

    equal(connection.live, true);

    await passTime(1);

    equal(connection.live, false);

    equal(globalThis.wsEvents?.at(-1), 'disconnect connection-1');
  });

  it('assert :: a client close stops the limits', async (t) => {
    const { connection, passTime } = await openConnection(t);

    await passTime(MINUTE);
    await connection.close();
    await passTime(120 * MINUTE);

    deepEqual(globalThis.wsEvents, ['connect connection-1', 'disconnect connection-1']);
  });

  it('assert :: local options change the limits', async (t) => {
    const { connection, sendMessage, passTime } = await openConnection(t, {
      ...serveOptions,
      localOptions: {
        lifecycle_ws: {
          idleTimeout: 30,
          connectionDuration: 45
        }
      }
    });

    await passTime(20_000);
    await sendMessage();
    await passTime(20_000);
    await sendMessage();
    await passTime(4_999);

    equal(connection.live, true);

    await passTime(1);

    equal(connection.live, false);
  });

  it('assert :: local options change the idle time', async (t) => {
    const { connection, passTime } = await openConnection(t, {
      ...serveOptions,
      localOptions: {
        lifecycle_ws: {
          idleTimeout: 30
        }
      }
    });

    await passTime(29_999);

    equal(connection.live, true);

    await passTime(1);

    equal(connection.live, false);
  });

  it('assert :: test options change the limits in tests', async (t) => {
    const { connection, passTime } = await openConnection(t, {
      ...serveOptions,
      test: true,
      localOptions: {
        lifecycle_ws: {
          idleTimeout: 30
        }
      },
      testOptions: {
        lifecycle_ws: {
          idleTimeout: 10
        }
      }
    });

    await passTime(9_999);

    equal(connection.live, true);

    await passTime(1);

    equal(connection.live, false);
  });
});
