import { describe, it } from 'node:test';
import { deepEqual, equal, throws } from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
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

  it('assert :: a remote route keeps its target and owner', () => {
    const home = mkdtempSync(join(tmpdir(), 'ez4-proxy-'));

    addRoute({ host: 'api.app.wt.localhost', port: 0, pid: process.pid, target: 'https://abc.execute-api.us-east-1.amazonaws.com' }, home);

    deepEqual(findRoute('api.app.wt.localhost', home), {
      host: 'api.app.wt.localhost',
      port: 0,
      pid: process.pid,
      target: 'https://abc.execute-api.us-east-1.amazonaws.com'
    });
  });

  it('assert :: a remote route to another scheme is ignored', () => {
    const home = mkdtempSync(join(tmpdir(), 'ez4-proxy-'));

    mkdirSync(join(home, 'routes'));
    writeFileSync(join(home, 'routes', 'bad.wt.localhost'), `remote ${process.pid} file:///etc/passwd`);

    equal(findRoute('bad.wt.localhost', home), undefined);
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
    removeRoute('site.wt.gaio.localhost', undefined, home);

    equal(findRoute('site.wt.gaio.localhost', home), undefined);
  });

  it('assert :: a host outside the hostname charset never reaches the filesystem', () => {
    const home = createHome();
    const outsideFile = join(home, 'outside');

    mkdirSync(join(home, 'routes'));
    writeFileSync(outsideFile, `4103 ${process.pid}`);

    equal(findRoute('../outside', home), undefined);
    removeRoute('../outside', undefined, home);
    equal(existsSync(outsideFile), true);
    throws(() => addRoute({ host: '../outside', port: 4103, pid: process.pid }, home), /Invalid route host/);
  });

  it('assert :: a route file with a malformed content is ignored and kept', () => {
    const home = createHome();
    const routeFile = join(home, 'routes', 'broken.wt.gaio.localhost');

    mkdirSync(join(home, 'routes'));
    writeFileSync(routeFile, 'garbage');

    equal(findRoute('broken.wt.gaio.localhost', home), undefined);
    equal(existsSync(routeFile), true);
  });

  it('assert :: an owner removes only the route it still owns', () => {
    const home = createHome();

    addRoute({ host: 'owned.wt.gaio.localhost', port: 4104, pid: process.pid }, home);

    removeRoute('owned.wt.gaio.localhost', getDeadPid(), home);
    equal(findRoute('owned.wt.gaio.localhost', home)?.pid, process.pid);

    removeRoute('owned.wt.gaio.localhost', process.pid, home);
    equal(findRoute('owned.wt.gaio.localhost', home), undefined);
  });
});
