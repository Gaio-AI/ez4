import type { DynamoDBDocumentClient, ExecuteStatementCommand } from '@aws-sdk/lib-dynamodb';
import type { Query } from '@ez4/database';
import type { TestTableMetadata } from './common/schema';

import { deepEqual, equal } from 'node:assert/strict';
import { afterEach, beforeEach, describe, it, mock } from 'node:test';

import { ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';

import { Table } from '../src/client/table';
import { TestSchema } from './common/schema';

type Upsert = Query.UpsertOneInput<{}, TestTableMetadata>;

type Statement = 'SELECT' | 'INSERT' | 'UPDATE';

/**
 * A table of one item, answering each statement as DynamoDB does: an insert over an existing key and
 * an update of a missing one are refused. `existsAfter` makes the item appear once that many
 * statements were answered, as another writer would create it.
 */
const getTable = (options: { exists: boolean; existsAfter?: number }) => {
  const statements: Statement[] = [];

  let exists = options.exists;

  const send = async (command: ExecuteStatementCommand) => {
    const statement = command.input.Statement?.split(' ')[0] as Statement;

    statements.push(statement);

    if (options.existsAfter !== undefined && statements.length > options.existsAfter) {
      exists = true;
    }

    if (statement === 'INSERT') {
      if (exists) {
        throw Object.assign(new Error('Duplicate primary key exists in table'), { name: 'DuplicateItemException' });
      }

      exists = true;

      return {};
    }

    if (statement === 'UPDATE') {
      if (!exists) {
        throw new ConditionalCheckFailedException({ message: 'The conditional request failed', $metadata: {} });
      }

      return { Items: command.input.Statement?.includes('RETURNING') ? [{ id: 'abc', foo: 2 }] : [] };
    }

    return { Items: exists ? [{ id: 'abc', foo: 1 }] : [] };
  };

  const client = { send } as unknown as DynamoDBDocumentClient;

  const table = new Table<TestTableMetadata>('ez4-test-upsert', TestSchema, [['id']], { client });

  return { table, statements };
};

const CLAIM: Upsert = {
  insert: { id: 'abc', foo: 1, bar: { barFoo: 'a', barBar: true }, baz: [], qux: [] },
  update: {},
  where: { id: 'abc' }
};

const REFRESH: Upsert = {
  insert: { id: 'abc', foo: 1, bar: { barFoo: 'a', barBar: true }, baz: [], qux: [] },
  update: { foo: 2 },
  where: { id: 'abc' }
};

describe('dynamodb upsert requests', () => {
  let errors: unknown[][] = [];

  beforeEach(() => {
    errors = [];

    mock.method(console, 'error', (...args: unknown[]) => {
      errors.push(args);
    });
  });

  afterEach(() => {
    mock.restoreAll();
  });

  it('assert :: an upsert with nothing to update inserts a new item in one request', async () => {
    const { table, statements } = getTable({ exists: false });

    const result = await table.upsertOne(CLAIM);

    deepEqual(result, { inserted: true });
    deepEqual(statements, ['INSERT']);
  });

  it('assert :: an upsert with nothing to update finds an existing item in one request, writing nothing', async () => {
    const { table, statements } = getTable({ exists: true });

    const result = await table.upsertOne(CLAIM);

    deepEqual(result, { inserted: false });
    deepEqual(statements, ['INSERT']);
    equal(errors.length, 0);
  });

  it('assert :: an upsert updates an existing item in one request', async () => {
    const { table, statements } = getTable({ exists: true });

    const result = await table.upsertOne(REFRESH);

    deepEqual(result, { inserted: false });
    deepEqual(statements, ['UPDATE']);
  });

  it('assert :: an upsert inserts a missing item after the update finds nothing, without an error log', async () => {
    const { table, statements } = getTable({ exists: false });

    const result = await table.upsertOne(REFRESH);

    deepEqual(result, { inserted: true });
    deepEqual(statements, ['UPDATE', 'INSERT']);
    equal(errors.length, 0);
  });

  it('assert :: an upsert updates the item another writer inserted in between', async () => {
    const { table, statements } = getTable({ exists: false, existsAfter: 1 });

    const result = await table.upsertOne(REFRESH);

    deepEqual(result, { inserted: false });
    deepEqual(statements, ['UPDATE', 'INSERT', 'UPDATE']);
    equal(errors.length, 0);
  });

  it('assert :: an upsert that selects answers the updated record of an existing item', async () => {
    const { table, statements } = getTable({ exists: true });

    const result = await table.upsertOne({ ...CLAIM, select: { foo: true } });

    deepEqual(result, { inserted: false, record: { foo: 2 } });
    deepEqual(statements, ['UPDATE']);
  });

  it('assert :: an upsert that selects answers the inserted record of a new item', async () => {
    const { table, statements } = getTable({ exists: false });

    const result = await table.upsertOne({ ...REFRESH, select: { foo: true } });

    deepEqual(result, { inserted: true, record: { foo: 1 } });
    deepEqual(statements, ['UPDATE', 'INSERT']);
  });
});
