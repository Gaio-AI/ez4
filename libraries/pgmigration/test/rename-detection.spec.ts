import type { PgTableIndex, PgTableRepository } from '@ez4/pgclient/library';
import type { AnySchema } from '@ez4/schema';

import { deepEqual, equal, ok } from 'node:assert/strict';
import { describe, it } from 'node:test';

import { getTableRepositoryChanges } from '@ez4/pgmigration/library';
import { getUpdateStepQueries } from '@ez4/pgmigration';
import { getTableRepository } from '@ez4/pgclient/library';
import { SchemaType } from '@ez4/schema';
import { Index } from '@ez4/database';

const getTable = (name: string, columns: string[]) => {
  const properties: Record<string, AnySchema> = {};

  for (const column of columns) {
    properties[column] = { type: SchemaType.String };
  }

  return getTableRepository([
    {
      name,
      indexes: [{ name: 'id', type: Index.Primary, columns: ['id'] }],
      schema: { type: SchemaType.Object, properties }
    }
  ]);
};

describe('migration :: table rename detection', () => {
  const droppedTable = getTable('workflow_events', ['id', 'contact_id', 'workflow_id', 'date', 'metadata', 'created_at', 'updated_at']);

  const addedTable = getTable('attendance_events', [
    'id',
    'account_id',
    'attendance_id',
    'type',
    'user_id',
    'from_user_id',
    'to_user_id',
    'created_at'
  ]);

  it('assert :: tables sharing a word and only generic columns are not a rename', () => {
    const changes = getTableRepositoryChanges(addedTable, droppedTable);

    equal(changes.rename, undefined);
    deepEqual(Object.keys(changes.create ?? {}), ['attendance_events']);
    deepEqual(Object.keys(changes.remove ?? {}), ['workflow_events']);
  });

  it('assert :: tables sharing a word and only generic columns are created and dropped', () => {
    const steps = getUpdateStepQueries(addedTable, droppedTable);

    const queries = [...steps.prepare.tables, ...steps.rollout.tables, ...steps.cleanup.tables].map(({ query }) => query);

    equal(
      queries.some((query) => query.includes('RENAME')),
      false
    );
  });

  it('assert :: a table keeping most of its columns is still a rename', () => {
    const source = getTable('contact_events', ['id', 'contact_id', 'type', 'created_at']);
    const target = getTable('person_events', ['id', 'contact_id', 'type', 'created_at', 'person_id']);

    const changes = getTableRepositoryChanges(target, source);

    deepEqual(changes.rename, { contact_events: 'person_events' });
  });
});

describe('migration :: index rename detection', () => {
  const getIndexedTable = (index: PgTableIndex) => {
    return getTableRepository([
      {
        name: 'runs',
        indexes: [{ name: 'id', type: Index.Primary, columns: ['id'] }, index],
        schema: {
          type: SchemaType.Object,
          properties: {
            id: { type: SchemaType.String },
            account_id: { type: SchemaType.String },
            started_at: { type: SchemaType.String },
            user_id: { type: SchemaType.String }
          }
        }
      }
    ]);
  };

  const getIndexQueries = (target: PgTableRepository, source: PgTableRepository) => {
    const steps = getUpdateStepQueries(target, source);

    return [...steps.rollout.indexes, ...steps.cleanup.indexes].map(({ query }) => query);
  };

  const plainIndex: PgTableIndex = {
    name: 'account_id:started_at',
    type: Index.Secondary,
    columns: ['account_id', 'started_at']
  };

  it('assert :: an index that only takes a name of its own is a rename', () => {
    const target = getIndexedTable({
      name: 'runs_account_started_sk',
      type: Index.Secondary,
      columns: ['account_id', 'started_at'],
      options: { name: 'runs_account_started_sk' }
    });

    const queries = getIndexQueries(target, getIndexedTable(plainIndex));

    deepEqual(queries, ['ALTER INDEX IF EXISTS "runs_account_id_started_at_sk" RENAME TO "runs_account_started_sk"']);
  });

  it('assert :: an index that also gains included columns is built, and the old one dropped', () => {
    const target = getIndexedTable({
      name: 'runs_account_started_people_sk',
      type: Index.Secondary,
      columns: ['account_id', 'started_at'],
      options: { name: 'runs_account_started_people_sk', include: ['user_id'] }
    });

    const queries = getIndexQueries(target, getIndexedTable(plainIndex));

    equal(
      queries.some((query) => query.includes('RENAME')),
      false
    );

    ok(queries.some((query) => query.includes('INCLUDE ("user_id")')));
    ok(queries.includes('DROP INDEX CONCURRENTLY IF EXISTS "runs_account_id_started_at_sk"'));
  });
});
