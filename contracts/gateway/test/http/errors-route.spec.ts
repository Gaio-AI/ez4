import { ok, deepEqual } from 'assert/strict';
import { describe, it } from 'node:test';

import { registerTriggers, IncompleteRouteError, InvalidReservedConcurrencyError } from '@ez4/gateway/library';
import { InvalidServicePropertyError } from '@ez4/common/library';

import { parseFile } from './common/parser';

describe('http route metadata errors', () => {
  registerTriggers();

  it('assert :: incomplete service routes', () => {
    const [error1, error2] = parseFile('incomplete-route', 2);

    ok(error1 instanceof IncompleteRouteError);
    deepEqual(error1.properties, ['path']);

    ok(error2 instanceof IncompleteRouteError);
    deepEqual(error2.properties, ['handler']);
  });

  it('assert :: invalid route property', () => {
    const [error1] = parseFile('invalid-route-property', 1);

    ok(error1 instanceof InvalidServicePropertyError);
    deepEqual(error1.propertyName, 'invalid_property');
  });

  it('assert :: invalid reserved concurrency', () => {
    const errors = parseFile('invalid-reserved-concurrency', 3);

    const values = errors.map((error) => {
      ok(error instanceof InvalidReservedConcurrencyError);

      return error.concurrencyValue;
    });

    deepEqual(values.sort(), [-1, 0, 2.5]);
  });
});
