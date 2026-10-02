import type { AddressInfo } from 'node:net';

import { describe, it } from 'node:test';
import { deepEqual, equal } from 'node:assert/strict';
import { existsSync, mkdtempSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';

import { getInputOptions } from '../src/terminal/options';
import { createProxyServer } from '../src/proxy/server';
import { toRouteHost } from '../src/terminal/commands/proxy';

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

    const result = spawnSync(process.execPath, ['bin/cli.mjs', 'proxy', 'run', 'demo.wt', '--', process.execPath, '-e', script], {
      env: { ...process.env, EZ4_PROXY_HOME: home, EZ4_PROXY_PORT: `${(proxy.address() as AddressInfo).port}` },
      encoding: 'utf8'
    });

    proxy.close();

    const output = JSON.parse(result.stdout.trim().split('\n').pop()!);

    equal(result.status, 0);
    equal(output.host, '127.0.0.1');
    equal(output.owner, 'demo.wt.localhost');
    equal(output.route, `${output.port} ${result.pid}`);
    equal(existsSync(routeFile), false);
  });
});
