import type { TestTableMetadata } from './common/schema';

import { equal } from 'node:assert/strict';
import { describe, it } from 'node:test';

import { prepareExists, prepareFindMany, prepareFindOne } from '../src/client/common/queries';
import { TestSchema } from './common/schema';

const TABLE = 'ez4-test-consistency';

// Primary key `id` and a secondary index on `foo`.
const INDEXES = [['id'], ['foo']];

describe('dynamodb query (read consistency)', () => {
  it('assert :: reads by the primary key are strongly consistent by default', () => {
    equal(prepareFindOne<TestTableMetadata, {}>(TABLE, TestSchema, INDEXES, { select: {}, where: { id: 'abc' } }).ConsistentRead, true);
    equal(
      prepareFindMany<TestTableMetadata, {}, false>(TABLE, TestSchema, INDEXES, { select: {}, where: { id: 'abc' } }).ConsistentRead,
      true
    );
    equal(prepareExists<TestTableMetadata, {}>(TABLE, TestSchema, INDEXES, { where: { id: 'abc' } }).ConsistentRead, true);
  });

  it('assert :: reads that ask for it are eventually consistent', () => {
    equal(
      prepareFindOne<TestTableMetadata, {}>(TABLE, TestSchema, INDEXES, { select: {}, where: { id: 'abc' }, consistent: false })
        .ConsistentRead,
      false
    );

    equal(
      prepareFindMany<TestTableMetadata, {}, false>(TABLE, TestSchema, INDEXES, { select: {}, where: { id: 'abc' }, consistent: false })
        .ConsistentRead,
      false
    );

    equal(
      prepareExists<TestTableMetadata, {}>(TABLE, TestSchema, INDEXES, { where: { id: 'abc' }, consistent: false }).ConsistentRead,
      false
    );
  });

  it('assert :: reads through a secondary index are always eventually consistent', () => {
    equal(
      prepareFindMany<TestTableMetadata, {}, false>(TABLE, TestSchema, INDEXES, { select: {}, where: { foo: 1 }, consistent: true })
        .ConsistentRead,
      false
    );
  });
});
