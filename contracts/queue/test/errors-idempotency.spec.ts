import { ok, equal, deepEqual } from 'assert/strict';
import { describe, it } from 'node:test';

import {
  IncompleteIdempotencyError,
  IncorrectIdempotencyKeyError,
  InvalidIdempotencyTtlError,
  InvalidIdempotencyTypeError
} from '@ez4/queue/library';

import { InvalidServicePropertyError } from '@ez4/common/library';
import { registerTriggers } from '@ez4/queue/library';

import { parseFile } from './common/parser';

describe('queue subscription idempotency metadata errors', () => {
  registerTriggers();

  it('assert :: incomplete idempotency', () => {
    const [error1] = parseFile('incomplete-idempotency', 1);

    ok(error1 instanceof IncompleteIdempotencyError);
    deepEqual(error1.properties, ['ttl']);
  });

  it('assert :: incorrect idempotency key', () => {
    const [error1, error2] = parseFile('incorrect-idempotency-key', 2);

    ok(error1 instanceof IncorrectIdempotencyKeyError);
    equal(error1.handlerName, 'testHandler');
    deepEqual(error1.properties, ['missing']);

    ok(error2 instanceof IncorrectIdempotencyKeyError);
    equal(error2.handlerName, 'otherHandler');
    deepEqual(error2.properties, ['note']);
  });

  it('assert :: invalid idempotency ttl', () => {
    const [error1] = parseFile('invalid-idempotency-ttl', 1);

    ok(error1 instanceof InvalidIdempotencyTtlError);
    equal(error1.property, 'ttl');
    equal(error1.value, '0');
  });

  it('assert :: invalid idempotency (declaration)', () => {
    const [error1] = parseFile('invalid-idempotency-class', 1);

    ok(error1 instanceof InvalidIdempotencyTypeError);
    equal(error1.baseType, 'Queue.Idempotency');
  });

  it('assert :: invalid idempotency (property)', () => {
    const [error1] = parseFile('invalid-idempotency-property', 1);

    ok(error1 instanceof InvalidServicePropertyError);
    equal(error1.propertyName, 'invalid_property');
  });
});
