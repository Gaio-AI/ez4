import { ok, equal, deepEqual } from 'assert/strict';
import { describe, it } from 'node:test';

import {
  registerTriggers,
  IncompleteThrottlingError,
  IncorrectThrottlingTypeError,
  InvalidThrottlingLimitError,
  InvalidThrottlingTypeError
} from '@ez4/gateway/library';

import { InvalidServicePropertyError } from '@ez4/common/library';

import { parseFile } from './common/parser';

describe('http throttling metadata errors', () => {
  registerTriggers();

  it('assert :: incomplete throttling', () => {
    const [error1] = parseFile('incomplete-throttling', 1);

    ok(error1 instanceof IncompleteThrottlingError);
    deepEqual(error1.properties, ['burstLimit']);
  });

  it('assert :: incorrect throttling', () => {
    const [error1] = parseFile('incorrect-throttling', 1);

    ok(error1 instanceof IncorrectThrottlingTypeError);
    equal(error1.baseType, 'Http.Throttling');
    equal(error1.modelType, 'TestThrottling');
  });

  it('assert :: invalid throttling (declaration)', () => {
    const [error1] = parseFile('invalid-throttling-class', 1);

    ok(error1 instanceof InvalidThrottlingTypeError);
    equal(error1.baseType, 'Http.Throttling');
  });

  it('assert :: invalid throttling (property)', () => {
    const [error1] = parseFile('invalid-throttling-property', 1);

    ok(error1 instanceof InvalidServicePropertyError);
    deepEqual(error1.propertyName, 'invalid_property');
  });

  it('assert :: invalid throttling (limits)', () => {
    const [error1, error2, error3] = parseFile('invalid-throttling-value', 3);

    ok(error1 instanceof InvalidThrottlingLimitError);
    equal(error1.limitName, 'rateLimit');
    equal(error1.limitValue, 0);

    ok(error2 instanceof InvalidThrottlingLimitError);
    equal(error2.limitName, 'burstLimit');
    equal(error2.limitValue, 2.5);

    ok(error3 instanceof InvalidThrottlingLimitError);
    equal(error3.limitName, 'burstLimit');
    equal(error3.limitValue, -5);
  });
});
