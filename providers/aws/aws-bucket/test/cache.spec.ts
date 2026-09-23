import { equal } from 'node:assert/strict';
import { describe, it } from 'node:test';

import { getObjectCacheControl } from '../src/triggers/cache';

describe('bucket object cache control', () => {
  const rules = [
    { path: 'index.html', value: 'no-cache' },
    { path: 'assets/*', value: 'public, max-age=31536000, immutable' },
    { path: '*', value: 'max-age=60' }
  ];

  it('assert :: exact key', () => {
    equal(getObjectCacheControl(rules, 'index.html'), 'no-cache');
  });

  it('assert :: prefix', () => {
    equal(getObjectCacheControl(rules, 'assets/index-abc123.js'), 'public, max-age=31536000, immutable');
    equal(getObjectCacheControl(rules, 'assets/fonts/inter.woff2'), 'public, max-age=31536000, immutable');
  });

  it('assert :: prefix does not match a sibling key', () => {
    equal(getObjectCacheControl(rules, 'assets-manifest.json'), 'max-age=60');
  });

  it('assert :: first match wins', () => {
    equal(getObjectCacheControl([{ path: '*', value: 'no-store' }, ...rules], 'assets/index.js'), 'no-store');
  });

  it('assert :: no match', () => {
    equal(getObjectCacheControl([{ path: 'assets/*', value: 'immutable' }], 'sw.js'), undefined);
    equal(getObjectCacheControl(undefined, 'sw.js'), undefined);
  });
});
