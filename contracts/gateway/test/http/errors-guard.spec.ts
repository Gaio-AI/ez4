import { ok, equal, deepEqual } from 'assert/strict';
import { describe, it } from 'node:test';

import {
  registerTriggers,
  ConflictingRouteAllowError,
  InvalidRouteAllowError,
  MissingRouteAllowError,
  UnguardedRouteAllowError
} from '@ez4/gateway/library';

import { parseFile } from './common/parser';

describe('http route guard metadata errors', () => {
  registerTriggers();

  it('assert :: guarded route without allow', () => {
    const [error1] = parseFile('missing-route-allow', 1);

    ok(error1 instanceof MissingRouteAllowError);
    equal(error1.routePath, 'POST /items');
  });

  it('assert :: allow without guard', () => {
    const [error1] = parseFile('unguarded-route-allow', 1);

    ok(error1 instanceof UnguardedRouteAllowError);
    equal(error1.routePath, 'GET /items');
  });

  it('assert :: routes sharing a function allow differently', () => {
    const [error1] = parseFile('conflicting-route-allow', 1);

    ok(error1 instanceof ConflictingRouteAllowError);
    equal(error1.handlerName, 'listItems');
    deepEqual(error1.routePaths, ['GET /items', 'GET /items/all']);
  });

  it('assert :: allow that is not a literal', () => {
    const [error1, error2] = parseFile('invalid-route-allow', 2);

    ok(error1 instanceof InvalidRouteAllowError);
    equal(error1.routePath, 'GET /items');

    ok(error2 instanceof InvalidRouteAllowError);
    equal(error2.routePath, 'POST /items');
  });
});
