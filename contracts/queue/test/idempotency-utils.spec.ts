import { describe, it } from 'node:test';
import { equal, notEqual } from 'node:assert/strict';

import { UnknownOutcomeError, getIdempotencyKey, isUnknownOutcomeError } from '@ez4/queue/utils';

describe('queue idempotency utils', () => {
  it('assert :: the key names the handler and every key field', () => {
    const key = getIdempotencyKey('testHandler', { jobId: 'job-1', contactId: 7, note: 'ignored' }, ['jobId', 'contactId']);

    equal(key, '["testHandler","job-1",7]');
  });

  it('assert :: no two value lists give the same key', () => {
    const joined = getIdempotencyKey('testHandler', { a: 'x:y', b: 'z' }, ['a', 'b']);
    const split = getIdempotencyKey('testHandler', { a: 'x', b: 'y:z' }, ['a', 'b']);

    notEqual(joined, split);
  });

  it('assert :: two handlers keep apart keys', () => {
    notEqual(getIdempotencyKey('a', { id: '1' }, ['id']), getIdempotencyKey('b', { id: '1' }, ['id']));
  });

  it('assert :: unknown outcome is told by its name', () => {
    const copy = new Error('sent, no answer');

    copy.name = 'UnknownOutcomeError';

    equal(isUnknownOutcomeError(new UnknownOutcomeError('sent, no answer')), true);
    equal(isUnknownOutcomeError(copy), true);
    equal(isUnknownOutcomeError(new Error('failed')), false);
    equal(isUnknownOutcomeError('UnknownOutcomeError'), false);
  });
});
