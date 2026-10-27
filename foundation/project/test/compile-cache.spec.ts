import { describe, it } from 'node:test';
import { equal } from 'node:assert/strict';
import { join } from 'node:path';

import { getCompileCacheDirectory } from '../src/terminal/compile-cache';
import { CommandType } from '../src/terminal/options';

const CHECKOUT = '/work/project';
const CHECKOUT_CACHE = join(CHECKOUT, 'node_modules', '.cache', 'ez4');

describe('compile cache', () => {
  it('assert :: serve runs without the cache', () => {
    equal(getCompileCacheDirectory({ command: CommandType.Serve }, {}, CHECKOUT), undefined);
  });

  it('assert :: serve runs without the cache a variable asks for', () => {
    equal(getCompileCacheDirectory({ command: CommandType.Serve }, { NODE_COMPILE_CACHE: '/tmp/cache' }, CHECKOUT), undefined);
  });

  it('assert :: test caches in the checkout', () => {
    equal(getCompileCacheDirectory({ command: CommandType.Test }, {}, CHECKOUT), CHECKOUT_CACHE);
  });

  it('assert :: run and deploy cache in the checkout', () => {
    equal(getCompileCacheDirectory({ command: CommandType.Run }, {}, CHECKOUT), CHECKOUT_CACHE);
    equal(getCompileCacheDirectory({ command: CommandType.Deploy }, {}, CHECKOUT), CHECKOUT_CACHE);
  });

  it('assert :: coverage runs without the cache', () => {
    equal(getCompileCacheDirectory({ command: CommandType.Test, coverage: true }, {}, CHECKOUT), undefined);
  });

  it('assert :: an outer coverage run goes without the cache', () => {
    equal(getCompileCacheDirectory({ command: CommandType.Test }, { NODE_V8_COVERAGE: '/tmp/coverage' }, CHECKOUT), undefined);
  });
});
