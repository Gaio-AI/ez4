import type { NativeAttributeValue } from '@aws-sdk/lib-dynamodb';
import type { TestContext } from 'node:test';

import { describe, it } from 'node:test';
import { equal, ok, rejects } from 'node:assert/strict';

import { ConditionalCheckFailedException, DynamoDBClient, ResourceInUseException } from '@aws-sdk/client-dynamodb';
import { DeleteCommand, DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { STSClient } from '@aws-sdk/client-sts';

import { triggerAllAsync } from '@ez4/project/library';

import { registerTriggers } from '../src/triggers/register';

type LockRow = Record<string, NativeAttributeValue>;

type ConditionValues = Record<string, NativeAttributeValue> | undefined;

const LOCK_ID = 'ez4-lock';

const lockFailure = {
  message: 'Failed to acquire exclusive lock.'
};

/**
 * DynamoDB evaluates a condition against the stored item, or against an empty one when there is none, and a
 * write whose condition doesn't hold changes nothing and fails with `ConditionalCheckFailedException`.
 */
const holdsCondition = (row: LockRow | undefined, expression: string, values: ConditionValues) => {
  const notExists = /^attribute_not_exists\((\w+)\)$/.exec(expression);

  if (notExists) {
    return row?.[notExists[1]] === undefined;
  }

  const equals = /^(\w+) = (:\w+)$/.exec(expression);

  if (equals) {
    return row?.[equals[1]] !== undefined && row[equals[1]] === values?.[equals[2]];
  }

  throw new Error(`Unsupported condition expression '${expression}'.`);
};

const assertCondition = (row: LockRow | undefined, expression: string | undefined, values: ConditionValues) => {
  if (expression && !holdsCondition(row, expression, values)) {
    throw new ConditionalCheckFailedException({
      message: 'The conditional request failed',
      $metadata: {}
    });
  }
};

// Stands in for the lock table, and for the account and table lookups before it, so no request leaves the process.
const mockLockTable = (t: TestContext, rows = new Map<string, LockRow>()) => {
  t.mock.method(STSClient.prototype, 'send', async () => ({
    Account: '000000000000'
  }));

  t.mock.method(DynamoDBClient.prototype, 'send', async () => {
    throw new ResourceInUseException({
      message: 'Table already exists',
      $metadata: {}
    });
  });

  t.mock.method(DynamoDBDocumentClient.prototype, 'send', async (command: PutCommand | DeleteCommand) => {
    const { ConditionExpression, ExpressionAttributeValues } = command.input;

    if (command instanceof PutCommand) {
      const item = command.input.Item!;

      assertCondition(rows.get(item.lock_id), ConditionExpression, ExpressionAttributeValues);

      rows.set(item.lock_id, item);

      return {};
    }

    const { lock_id } = command.input.Key!;

    assertCondition(rows.get(lock_id), ConditionExpression, ExpressionAttributeValues);

    rows.delete(lock_id);

    return {};
  });

  return rows;
};

const lock = (ownerId: string) => {
  return triggerAllAsync('deploy:lock', (handler) => handler({ lockId: LOCK_ID, ownerId }));
};

const unlock = (ownerId: string) => {
  return triggerAllAsync('deploy:unlock', (handler) => handler({ lockId: LOCK_ID, ownerId }));
};

registerTriggers();

describe('aws deploy lock', () => {
  it('assert :: a release from a run that failed to acquire the lock leaves it in place', async (t) => {
    const rows = mockLockTable(t);

    await lock('deploy-a');

    await rejects(lock('deploy-b'), lockFailure);

    await unlock('deploy-b');

    ok(rows.has(LOCK_ID), 'deploy B released the lock deploy A holds');

    await rejects(lock('deploy-c'), lockFailure, 'deploy C acquired the lock while deploy A applies');

    equal(rows.get(LOCK_ID)?.owner_id, 'deploy-a');

    await unlock('deploy-a');

    equal(rows.has(LOCK_ID), false);

    await lock('deploy-c');

    equal(rows.get(LOCK_ID)?.owner_id, 'deploy-c');
  });

  it('assert :: a release leaves a lock written without an owner', async (t) => {
    const rows = mockLockTable(
      t,
      new Map([
        [
          LOCK_ID,
          {
            created_at: '2020-01-01T00:00:00.000Z',
            user_name: 'previous-version',
            lock_id: LOCK_ID
          }
        ]
      ])
    );

    await unlock('deploy-a');

    ok(rows.has(LOCK_ID), 'a lock without an owner was released by another run');

    await rejects(lock('deploy-a'), lockFailure);
  });
});
