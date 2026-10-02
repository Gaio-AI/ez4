import type { LinkedContext } from '../src/types/service';

import { describe, it } from 'node:test';
import { deepEqual } from 'node:assert/strict';

import { getDisabledProjects } from '../src/utils/service';

const getClient = (disabledProject?: string, context?: Record<string, LinkedContext>): LinkedContext => {
  return {
    module: 'Client',
    from: '@test/client',
    constructor: '@{EZ4_MODULE_IMPORT}.make()',
    ...(disabledProject && { disabledProject }),
    ...(context && { context })
  };
};

describe('project disabled imports', () => {
  it('assert :: no context or no disabled import gives none', () => {
    deepEqual(getDisabledProjects(undefined), []);
    deepEqual(getDisabledProjects({ api: getClient() }), []);
  });

  it('assert :: disabled projects come sorted and once', () => {
    const context = {
      second: getClient('@test/second'),
      first: getClient('@test/first'),
      again: getClient('@test/second'),
      enabled: getClient()
    };

    deepEqual(getDisabledProjects(context), ['@test/first', '@test/second']);
  });

  it('assert :: only the referenced services count', () => {
    const context = {
      used: getClient(),
      unused: getClient('@test/unused')
    };

    deepEqual(getDisabledProjects(context, ['used']), []);
    deepEqual(getDisabledProjects(context, ['used', 'unused']), ['@test/unused']);
  });

  it('assert :: a disabled import inside a linked service counts', () => {
    const shared: Record<string, LinkedContext> = {};

    const factory = getClient(undefined, shared);

    // A service reached again through its own context is visited once.
    shared.inner = getClient('@test/inner');
    shared.factory = factory;

    deepEqual(getDisabledProjects({ factory }, ['factory']), ['@test/inner']);
  });
});
