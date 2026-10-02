import { afterEach, describe, it } from 'node:test';
import { equal } from 'node:assert/strict';

import { getServiceHost } from '../src/utils/project';

afterEach(() => {
  delete process.env.EZ4_PROXY_PORT;
});

describe('service host', () => {
  it('assert :: without proxy the host is localHost and localPort', () => {
    equal(getServiceHost({ projectName: 'console', serveOptions: { localPort: 3739 } }), 'localhost:3739');
    equal(getServiceHost({ projectName: 'console' }), 'localhost:3734');
  });

  it('assert :: with proxy on port 80 the host has no port', () => {
    const project = { projectName: 'console', branchName: 'feat/x', serveOptions: { proxy: { domain: 'gaio' } } };

    equal(getServiceHost(project), 'console.feat-x.gaio.localhost');
  });

  it('assert :: the cli branch wins over the project branch', () => {
    const project = { projectName: 'console', branchName: 'one', serveOptions: { proxy: { domain: 'gaio' } } };

    equal(getServiceHost(project, 'two'), 'console.two.gaio.localhost');
  });

  it('assert :: a non-default proxy port is kept', () => {
    process.env.EZ4_PROXY_PORT = '1355';

    equal(getServiceHost({ projectName: 'payment', serveOptions: { proxy: { domain: 'gaio' } } }), 'payment.gaio.localhost:1355');
  });
});
