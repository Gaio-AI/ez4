import { describe, it } from 'node:test';
import { deepEqual, rejects } from 'node:assert/strict';

import { getForwarderArgs, planProxyListen } from '../src/proxy/port';

const probe = (canBind: boolean, hasDocker: boolean) => ({
  canBind: async () => canBind,
  hasDocker: () => hasDocker
});

describe('proxy port', () => {
  it('assert :: a port other than 80 is used as is', async () => {
    deepEqual(await planProxyListen(1355, probe(false, false)), { listenPort: 1355, forwarder: false });
  });

  it('assert :: port 80 is bound directly when allowed', async () => {
    deepEqual(await planProxyListen(80, probe(true, true)), { listenPort: 80, forwarder: false });
  });

  it('assert :: port 80 falls back to the docker forwarder', async () => {
    deepEqual(await planProxyListen(80, probe(false, true)), { listenPort: 1355, forwarder: true });
  });

  it('assert :: port 80 without permission nor docker points to setup', async () => {
    await rejects(planProxyListen(80, probe(false, false)), /ez4 proxy setup/);
  });

  it('assert :: the forwarder repeats port 80 on ipv4 and ipv6', () => {
    deepEqual(getForwarderArgs(1355), [
      'run',
      '-d',
      '--restart',
      'unless-stopped',
      '--name',
      'ez4-proxy-80',
      '--network',
      'host',
      'alpine/socat',
      'TCP6-LISTEN:80,fork,reuseaddr,ipv6only=0',
      'TCP4:127.0.0.1:1355'
    ]);
  });
});
