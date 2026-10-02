import { describe, it } from 'node:test';
import { deepEqual, equal } from 'node:assert/strict';
import { existsSync, mkdtempSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { addRoute, findRoute, listRoutes, removeRoute } from '../src/proxy/routes';

const createHome = () => mkdtempSync(join(tmpdir(), 'ez4-proxy-'));

const getDeadPid = () => spawnSync(process.execPath, ['-e', '']).pid!;

describe('proxy routes', () => {
  it('assert :: a route of a live process is found', () => {
    const home = createHome();

    addRoute({ host: 'console.wt.gaio.localhost', port: 4100, pid: process.pid }, home);

    deepEqual(findRoute('console.wt.gaio.localhost', home), { host: 'console.wt.gaio.localhost', port: 4100, pid: process.pid });
    deepEqual(listRoutes(home), [{ host: 'console.wt.gaio.localhost', port: 4100, pid: process.pid }]);
  });

  it('assert :: a route of a dead process is dropped', () => {
    const home = createHome();

    addRoute({ host: 'payment.wt.gaio.localhost', port: 4101, pid: getDeadPid() }, home);

    equal(findRoute('payment.wt.gaio.localhost', home), undefined);
    equal(existsSync(join(home, 'routes', 'payment.wt.gaio.localhost')), false);
    deepEqual(listRoutes(home), []);
  });

  it('assert :: a removed route is gone', () => {
    const home = createHome();

    addRoute({ host: 'site.wt.gaio.localhost', port: 4102, pid: process.pid }, home);
    removeRoute('site.wt.gaio.localhost', home);

    equal(findRoute('site.wt.gaio.localhost', home), undefined);
  });
});
