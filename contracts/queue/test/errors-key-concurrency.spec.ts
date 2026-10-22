import { ok, equal, deepEqual } from 'assert/strict';
import { describe, it } from 'node:test';

import {
  IncompleteKeyConcurrencyError,
  IncorrectKeyConcurrencyKeyError,
  InvalidKeyConcurrencyMaxError,
  InvalidKeyConcurrencyQueueError
} from '@ez4/queue/library';

import { registerTriggers } from '@ez4/queue/library';

import { parseFile } from './common/parser';

describe('queue subscription key concurrency metadata errors', () => {
  registerTriggers();

  it('assert :: incomplete key concurrency', () => {
    const [error1] = parseFile('incomplete-key-concurrency', 1);

    ok(error1 instanceof IncompleteKeyConcurrencyError);
    deepEqual(error1.properties, ['max']);
  });

  it('assert :: incorrect key concurrency key', () => {
    const [error1] = parseFile('incorrect-key-concurrency-key', 1);

    ok(error1 instanceof IncorrectKeyConcurrencyKeyError);
    equal(error1.handlerName, 'testHandler');
    deepEqual(error1.properties, ['note']);
  });

  it('assert :: invalid key concurrency max', () => {
    const [error1] = parseFile('invalid-key-concurrency-max', 1);

    ok(error1 instanceof InvalidKeyConcurrencyMaxError);
    equal(error1.property, 'max');
    equal(error1.value, '1.5');
  });

  it('assert :: invalid key concurrency (fifo queue)', () => {
    const [error1] = parseFile('invalid-key-concurrency-fifo', 1);

    ok(error1 instanceof InvalidKeyConcurrencyQueueError);
    equal(error1.handlerName, 'testHandler');
  });
});
