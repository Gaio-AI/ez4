import { equal } from 'node:assert/strict';
import { describe, it } from 'node:test';

import { DatabaseErrorException } from '@aws-sdk/client-rds-data';
import { isAuthenticationException, isDeadlockException, isDuplicateUniqueKeyException } from '@ez4/aws-aurora/client';

const makeDatabaseError = (message: string) => {
  return new DatabaseErrorException({
    $metadata: {},
    message
  });
};

describe('aurora client errors', () => {
  it('assert :: duplicate unique key', () => {
    const error = makeDatabaseError(
      'ERROR: duplicate key value violates unique constraint "parent_pkey"\n' +
        '  Detail: Key (id)=(17841423505) already exists.; SQLState: 23505'
    );

    equal(isDuplicateUniqueKeyException(error), true);
    equal(isAuthenticationException(error), false);
    equal(isDeadlockException(error), false);
  });

  it('assert :: deadlock', () => {
    const error = makeDatabaseError(
      'ERROR: deadlock detected\n' +
        '  Detail: Process 82 waits for ShareLock on transaction 755; blocked by process 83.\n' +
        'Process 83 waits for ShareLock on transaction 754; blocked by process 82.\n' +
        '  Hint: See server log for query details.\n' +
        '  Where: while updating tuple (0,2) in relation "parent"; SQLState: 40P01'
    );

    equal(isDeadlockException(error), true);
    equal(isDuplicateUniqueKeyException(error), false);
    equal(isAuthenticationException(error), false);
  });

  it('assert :: authentication failure', () => {
    const error = makeDatabaseError('FATAL: password authentication failed for user "postgres"; SQLState: 28P01');

    equal(isAuthenticationException(error), true);
    equal(isDuplicateUniqueKeyException(error), false);
    equal(isDeadlockException(error), false);
  });

  it('assert :: out of range value containing 23505 is not a duplicate unique key', () => {
    const error = makeDatabaseError(
      'ERROR: value "17841423505123456" is out of range for type integer\n' +
        "  Where: unnamed portal parameter $1 = '...'; SQLState: 22003"
    );

    equal(isDuplicateUniqueKeyException(error), false);
  });

  it('assert :: foreign key violation containing 23505 is not a duplicate unique key', () => {
    const error = makeDatabaseError(
      'ERROR: insert or update on table "child" violates foreign key constraint "child_parent_id_fkey"\n' +
        '  Detail: Key (parent_id)=(acct-23505) is not present in table "parent".; SQLState: 23503'
    );

    equal(isDuplicateUniqueKeyException(error), false);
  });

  it('assert :: foreign key violation containing a sql state suffix is not a duplicate unique key', () => {
    const error = makeDatabaseError(
      'ERROR: insert or update on table "child" violates foreign key constraint "child_parent_id_fkey"\n' +
        '  Detail: Key (parent_id)=(x; SQLState: 23505) is not present in table "parent".; SQLState: 23503'
    );

    equal(isDuplicateUniqueKeyException(error), false);
  });

  it('assert :: invalid input containing 28P01 is not an authentication failure', () => {
    const error = makeDatabaseError(
      'ERROR: invalid input syntax for type integer: "x28P01"\n' + "  Where: unnamed portal parameter $1 = '...'; SQLState: 22P02"
    );

    equal(isAuthenticationException(error), false);
  });

  it('assert :: invalid input containing 40P01 is not a deadlock', () => {
    const error = makeDatabaseError(
      'ERROR: invalid input syntax for type integer: "x40P01"\n' + "  Where: unnamed portal parameter $1 = '...'; SQLState: 22P02"
    );

    equal(isDeadlockException(error), false);
  });

  it('assert :: only data api database errors are classified', () => {
    const error = new Error('ERROR: duplicate key value violates unique constraint "parent_pkey"; SQLState: 23505');

    equal(isDuplicateUniqueKeyException(error), false);
  });
});
