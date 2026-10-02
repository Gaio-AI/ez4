import { describe, it } from 'node:test';
import { deepEqual } from 'node:assert/strict';

import { getServeBind } from '../src/utils/project';

describe('serve bind', () => {
  it('assert :: without proxy it binds localHost and localPort as today', () => {
    deepEqual(getServeBind({ localPort: 3739 }, {}), { host: '0.0.0.0', port: 3739, register: false });
  });

  it('assert :: with proxy and no wrapper it binds a free loopback port and registers itself', () => {
    deepEqual(getServeBind({ proxy: { domain: 'gaio' } }, {}), { host: '127.0.0.1', port: 0, register: true });
  });

  it('assert :: under ez4 proxy run it binds the given port and leaves the route to the wrapper', () => {
    const env = { PORT: '4321', EZ4_PROXY_ROUTE: 'console.wt.gaio.localhost' };

    deepEqual(getServeBind({ proxy: { domain: 'gaio' } }, env), { host: '127.0.0.1', port: 4321, register: false });
  });
});
