import type { DynamoDBDocumentClient, ExecuteStatementCommand } from '@aws-sdk/lib-dynamodb';
import type { TestTableMetadata } from './common/schema';

import { equal, rejects } from 'node:assert/strict';
import { afterEach, beforeEach, describe, it, mock } from 'node:test';

import { ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';

import { Table } from '../src/client/table';
import { TestSchema } from './common/schema';

/**
 * A table whose every statement is refused with the given error.
 */
const getTable = (getError: () => Error) => {
  const send = async (_command: ExecuteStatementCommand) => {
    throw getError();
  };

  const client = { send } as unknown as DynamoDBDocumentClient;

  return new Table<TestTableMetadata>('ez4-test-errors', TestSchema, [['id']], { client });
};

const getConditionalFailure = () => {
  return new ConditionalCheckFailedException({ message: 'The conditional request failed', $metadata: {} });
};

const getDuplicateItem = () => {
  return Object.assign(new Error('Duplicate primary key exists in table'), { name: 'DuplicateItemException' });
};

const getValidationError = () => {
  return Object.assign(new Error('Statement wasn’t well formed'), { name: 'ValidationException' });
};

const ITEM = { id: 'abc', foo: 1, bar: { barFoo: 'a', barBar: true }, baz: [], qux: [] };

describe('dynamodb expected statement errors', () => {
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

  it('assert :: an update that fails its condition answers nothing, without an error log', async () => {
    const table = getTable(getConditionalFailure);

    const result = await table.updateOne({ data: { foo: 2 }, where: { id: 'abc', foo: 1 } });

    equal(result, undefined);
    equal(errors.length, 0);
  });

  it('assert :: an insert over an existing key throws the duplicate, without an error log', async () => {
    const table = getTable(getDuplicateItem);

    await rejects(() => table.insertOne({ data: ITEM }), { name: 'DuplicateItemException' });

    equal(errors.length, 0);
  });

  it('assert :: a delete that fails its condition throws it, without an error log', async () => {
    const table = getTable(getConditionalFailure);

    await rejects(() => table.deleteOne({ where: { id: 'abc', foo: 1 } }), ConditionalCheckFailedException);

    equal(errors.length, 0);
  });

  it('assert :: an unexpected failure is still logged with its statement', async () => {
    const table = getTable(getValidationError);

    await rejects(() => table.updateOne({ data: { foo: 2 }, where: { id: 'abc' } }), { name: 'ValidationException' });
    await rejects(() => table.insertOne({ data: ITEM }), { name: 'ValidationException' });
    await rejects(() => table.deleteOne({ where: { id: 'abc' } }), { name: 'ValidationException' });

    equal(errors.length, 3);
  });
});
