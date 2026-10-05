import type { AddressInfo } from 'node:net';

import { describe, it } from 'node:test';
import { deepEqual, equal, match } from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';

import { getInputOptions } from '../src/terminal/options';
import { createProxyServer } from '../src/proxy/server';
import { toRouteHost } from '../src/terminal/commands/proxy';

const runCli = (home: string, ...argv: string[]) => {
  return spawnSync(process.execPath, ['bin/cli.mjs', ...argv], {
    env: { ...process.env, EZ4_PROXY_HOME: home, EZ4_PROXY_PORT: '1' },
    encoding: 'utf8'
  });
};

const parse = (...argv: string[]) => {
  const previousArgv = process.argv;

  try {
    process.argv = ['node', 'ez4', ...argv];
    return getInputOptions();
  } finally {
    process.argv = previousArgv;
  }
};

describe('proxy cli', () => {
  it('assert :: proxy keeps its subcommand and target as positionals', () => {
    const input = parse('proxy', 'run', '-d', 'console.wt', '--', 'npm', 'run', 'serve');

    equal(input.command, 'proxy');
    equal(input.detach, true);
    deepEqual(input.positionals, ['run', 'console.wt']);
    deepEqual(input.arguments, ['npm', 'run', 'serve']);
  });

  it('assert :: other commands collect no positionals', () => {
    equal(parse('serve', '--local').positionals, undefined);
  });

  it('assert :: a route name becomes a localhost host without port', () => {
    equal(toRouteHost('console.wt'), 'console.wt.localhost');
    equal(toRouteHost('console.wt.gaio.localhost:1355'), 'console.wt.gaio.localhost');
  });

  it('assert :: run exports the port, owns the route while alive and removes it on exit', async () => {
    const home = mkdtempSync(join(tmpdir(), 'ez4-proxy-'));
    const proxy = createProxyServer(home);

    proxy.listen(0, '127.0.0.1');
    await once(proxy, 'listening');

    const routeFile = join(home, 'routes', 'demo.wt.localhost');
    const script = `const fs = require('fs'); console.log(JSON.stringify({ port: process.env.PORT, host: process.env.HOST, owner: process.env.EZ4_PROXY_ROUTE, route: fs.readFileSync(${JSON.stringify(routeFile)}, 'utf8') }))`;

    const child = spawn(process.execPath, ['bin/cli.mjs', 'proxy', 'run', 'demo.wt', '--', process.execPath, '-e', script], {
      env: { ...process.env, EZ4_PROXY_HOME: home, EZ4_PROXY_PORT: `${(proxy.address() as AddressInfo).port}` }
    });

    let stdout = '';
    child.stdout.on('data', (chunk) => (stdout += chunk));

    const [status] = await once(child, 'exit');

    proxy.close();

    const output = JSON.parse(stdout.trim().split('\n').pop()!);

    equal(status, 0);
    equal(output.host, '127.0.0.1');
    equal(output.owner, 'demo.wt.localhost');
    equal(output.route, `${output.port} ${child.pid}`);
    equal(existsSync(routeFile), false);
  });

  it('assert :: run refuses a route owned by another live process', () => {
    const home = mkdtempSync(join(tmpdir(), 'ez4-proxy-'));
    const routeFile = join(home, 'routes', 'busy.wt.localhost');

    mkdirSync(join(home, 'routes'));
    writeFileSync(routeFile, `4000 ${process.pid}`);

    for (const detach of [[], ['-d']]) {
      const result = runCli(home, 'proxy', 'run', ...detach, 'busy.wt', '--', process.execPath, '-e', '');

      equal(result.status, 1);
      match(result.stderr + result.stdout, new RegExp(`busy.wt.localhost is already running \\(pid ${process.pid}\\)`));
      equal(readFileSync(routeFile, 'utf8'), `4000 ${process.pid}`);
    }
  });

  it('assert :: run without a command is a usage error', () => {
    const home = mkdtempSync(join(tmpdir(), 'ez4-proxy-'));

    for (const detach of [[], ['-d']]) {
      const result = runCli(home, 'proxy', 'run', ...detach, 'idle.wt');

      equal(result.status, 1);
      match(result.stderr + result.stdout, /Missing command, e\.g\. `ez4 proxy run idle\.wt -- npm run serve`/);
    }
  });
});
