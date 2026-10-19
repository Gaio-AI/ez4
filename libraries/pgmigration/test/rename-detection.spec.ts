import type { AnySchema } from '@ez4/schema';

import { deepEqual, equal } from 'node:assert/strict';
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
