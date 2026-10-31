import type { DatabaseTable, TableIndex, TableTimestamps } from '@ez4/database/library';
import type { ObjectSchemaProperties } from '@ez4/schema';

import { describe, it } from 'node:test';
import type { MigrationTimestampsError } from '@ez4/pgmigration/library';

import { deepEqual, equal, throws } from 'assert/strict';

import { getCreateQueries, getMigrationStatements, getMigrationWarnings, getUpdateStepQueries, validateRepository } from '@ez4/pgmigration';
import { getTableRepositoryChanges } from '@ez4/pgmigration/library';
import { getTableRepository } from '@ez4/pgclient/library';
import { SchemaType } from '@ez4/schema';
import { Index } from '@ez4/database';

const STAMP = `date_trunc('milliseconds', statement_timestamp())`;

const getStampFunction = (column: string) => {
  return (
    `CREATE OR REPLACE FUNCTION "ez4_stamp_${column}"() RETURNS trigger LANGUAGE plpgsql AS ` +
    `$fn$ BEGIN NEW."${column}" := ${STAMP}; RETURN NEW; END $fn$`
  );
};

const getStampTrigger = (table: string, column: string) => {
  return `CREATE TRIGGER "ez4_stamp_${column}" BEFORE UPDATE ON "${table}" FOR EACH ROW EXECUTE FUNCTION "ez4_stamp_${column}"()`;
};

const getStampTriggerCheck = (table: string, column: string) => {
  return `SELECT 1 FROM "pg_trigger" WHERE "tgname" = 'ez4_stamp_${column}' AND "tgrelid" = to_regclass('"${table}"')`;
};

describe('migration :: timestamps tests', () => {
  const getTable = (
    name: string,
    timestamps?: TableTimestamps,
    options?: { properties?: ObjectSchemaProperties; indexes?: TableIndex[]; renamedFrom?: DatabaseTable['renamedFrom'] }
  ): DatabaseTable => {
    return {
      name,
      ...(timestamps && { timestamps }),
      ...(options?.renamedFrom && { renamedFrom: options.renamedFrom }),
      indexes: [{ name: 'id', type: Index.Primary, columns: ['id'] }, ...(options?.indexes ?? [])],
      schema: {
        type: SchemaType.Object,
        properties: options?.properties ?? {
          id: { type: SchemaType.String },
          name: { type: SchemaType.String },
          created_at: { type: SchemaType.String, format: 'date-time' },
          updated_at: { type: SchemaType.String, format: 'date-time' }
        }
      }
    };
  };

  const both = { created: 'created_at', updated: 'updated_at' };

  it('assert :: tables without timestamps migrate as before', () => {
    const repository = getTableRepository([{ ...getTable('table'), timestamps: undefined }]);

    // No key for the option, so the repository compares (and hashes) as it did before it existed.
    deepEqual(Object.keys(repository.table).sort(), ['indexes', 'name', 'relations', 'schema']);

    equal(getTableRepositoryChanges(repository, repository).counts, 0);

    deepEqual(getMigrationStatements(repository, repository), {});

    equal('triggers' in getCreateQueries(repository), false);

    const steps = getUpdateStepQueries(getTableRepository([getTable('table'), getTable('other')]), repository);

    equal('triggers' in steps.prepare, false);
    equal('triggers' in steps.rollout, false);
    equal('triggers' in steps.cleanup, false);
  });

  it('assert :: table gaining timestamps (prepare only)', () => {
    const source = getTableRepository([getTable('table')]);
    const target = getTableRepository([getTable('table', both)]);

    deepEqual(getMigrationStatements(target, source), {
      'prepare.1': getStampFunction('updated_at'),
      'prepare.2':
        `ALTER TABLE IF EXISTS "table" ALTER COLUMN "created_at" SET DEFAULT ${STAMP}, ` + `ALTER COLUMN "updated_at" SET DEFAULT ${STAMP}`,
      'prepare.3': getStampTrigger('table', 'updated_at')
    });

    const [, , trigger] = getUpdateStepQueries(target, source).prepare.triggers ?? [];

    equal(trigger.check, getStampTriggerCheck('table', 'updated_at'));
  });

  it('assert :: table gaining a creation timestamp only', () => {
    const source = getTableRepository([getTable('table')]);
    const target = getTableRepository([getTable('table', { created: 'created_at' })]);

    deepEqual(getMigrationStatements(target, source), {
      'prepare.1': `ALTER TABLE IF EXISTS "table" ALTER COLUMN "created_at" SET DEFAULT ${STAMP}`
    });
  });

  it('assert :: table dropping timestamps (cleanup only)', () => {
    const source = getTableRepository([getTable('table', both)]);
    const target = getTableRepository([getTable('table')]);

    deepEqual(getMigrationStatements(target, source), {
      'cleanup.1': `DROP TRIGGER IF EXISTS "ez4_stamp_updated_at" ON "table"`,
      'cleanup.2': `ALTER TABLE IF EXISTS "table" ALTER COLUMN "created_at" DROP DEFAULT, ALTER COLUMN "updated_at" DROP DEFAULT`,
      'cleanup.3': `DROP FUNCTION IF EXISTS "ez4_stamp_updated_at"() RESTRICT`
    });
  });

  it('assert :: table dropping timestamps keeps the default the column declares', () => {
    const properties: ObjectSchemaProperties = {
      id: { type: SchemaType.String },
      created_at: { type: SchemaType.String, format: 'date-time', definitions: { default: '2026-01-01T00:00:00.000Z' } }
    };

    const source = getTableRepository([getTable('table', { created: 'created_at' }, { properties })]);
    const target = getTableRepository([getTable('table', undefined, { properties })]);

    deepEqual(getMigrationStatements(target, source), {
      'cleanup.1': `ALTER TABLE IF EXISTS "table" ALTER COLUMN "created_at" SET DEFAULT '2026-01-01T00:00:00.000Z'`
    });
  });

  it('assert :: tables sharing the stamp function create it once', () => {
    const source = getTableRepository([getTable('table_a'), getTable('table_b')]);
    const target = getTableRepository([getTable('table_a', both), getTable('table_b', both), getTable('table_c', both)]);

    const statements = Object.values(getMigrationStatements(target, source));

    const functions = statements.filter((query) => query.startsWith('CREATE OR REPLACE FUNCTION'));
    const triggers = statements.filter((query) => query.startsWith('CREATE TRIGGER'));

    deepEqual(functions, [getStampFunction('updated_at')]);

    deepEqual(triggers, [
      getStampTrigger('table_c', 'updated_at'),
      getStampTrigger('table_a', 'updated_at'),
      getStampTrigger('table_b', 'updated_at')
    ]);

    // The function comes before every trigger that runs it.
    equal(statements.indexOf(functions[0]) < statements.indexOf(triggers[0]), true);
  });

  it('assert :: stamp function kept while another table runs it', () => {
    const source = getTableRepository([getTable('table_a', both), getTable('table_b', both)]);
    const target = getTableRepository([getTable('table_a'), getTable('table_b', both)]);

    deepEqual(getMigrationStatements(target, source), {
      'cleanup.1': `DROP TRIGGER IF EXISTS "ez4_stamp_updated_at" ON "table_a"`,
      'cleanup.2': `ALTER TABLE IF EXISTS "table_a" ALTER COLUMN "created_at" DROP DEFAULT, ALTER COLUMN "updated_at" DROP DEFAULT`
    });
  });

  it('assert :: stamp function dropped with the last table running it', () => {
    const source = getTableRepository([getTable('table_a', both), getTable('table_b')]);
    const target = getTableRepository([getTable('table_b')]);

    deepEqual(getMigrationStatements(target, source), {
      'cleanup.1': `DROP TRIGGER IF EXISTS "ez4_stamp_updated_at" ON "table_a"`,
      'cleanup.2': `DROP FUNCTION IF EXISTS "ez4_stamp_updated_at"() RESTRICT`,
      'cleanup.3': `DROP TABLE IF EXISTS "table_a" CASCADE`
    });
  });

  it('assert :: new timestamp column on a table with timestamps', () => {
    const properties: ObjectSchemaProperties = {
      id: { type: SchemaType.String },
      updated_at: { type: SchemaType.String, format: 'date-time' }
    };

    const source = getTableRepository([getTable('table', { updated: 'updated_at' }, { properties })]);

    const target = getTableRepository([
      getTable('table', both, {
        properties: {
          ...properties,
          created_at: { type: SchemaType.String, format: 'date-time' }
        }
      })
    ]);

    // The column comes with its default, and a table that has its records writes the timestamp in each one.
    deepEqual(getMigrationStatements(target, source), {
      'prepare.1': `ALTER TABLE IF EXISTS "table" ADD COLUMN IF NOT EXISTS "created_at" timestamptz DEFAULT ${STAMP} NOT null`
    });
  });

  it('assert :: timestamp column changes keep its default', () => {
    const getProperties = (definitions?: { default: string }): ObjectSchemaProperties => ({
      id: { type: SchemaType.String },
      updated_at: { type: SchemaType.String, format: 'date-time', ...(definitions && { definitions }) }
    });

    const source = getTableRepository([
      getTable('table', { updated: 'updated_at' }, { properties: getProperties({ default: '2026-01-01T00:00:00.000Z' }) })
    ]);

    const target = getTableRepository([getTable('table', { updated: 'updated_at' }, { properties: getProperties() })]);

    deepEqual(getMigrationStatements(target, source), {
      'rollout.1': `ALTER TABLE IF EXISTS "table" ALTER COLUMN "updated_at" SET DEFAULT ${STAMP}`
    });
  });

  it('assert :: renaming a timestamp column', () => {
    const getProperties = (column: string): ObjectSchemaProperties => ({
      id: { type: SchemaType.String },
      [column]: { type: SchemaType.String, format: 'date-time' }
    });

    const source = getTableRepository([getTable('table', { updated: 'updated_at' }, { properties: getProperties('updated_at') })]);

    const assertRenameError = (target: DatabaseTable, toColumn: string) => {
      throws(
        () => getUpdateStepQueries(getTableRepository([target]), source),
        (error: MigrationTimestampsError) => {
          equal(error.table, 'table');

          equal(
            error.message,
            `Table table renames updated_at to ${toColumn}, a timestamp column: drop the timestamps on the column, ` +
              `rename it and declare them again in separate deploys.`
          );

          return true;
        }
      );
    };

    // Declared, onto the column the trigger writes now.
    assertRenameError(
      getTable(
        'table',
        { updated: 'modified_at' },
        { properties: getProperties('modified_at'), renamedFrom: { columns: { modified_at: 'updated_at' } } }
      ),
      'modified_at'
    );

    // Found by the names, while the table drops its timestamps in the same deploy.
    assertRenameError(getTable('table', undefined, { properties: getProperties('updated_on') }), 'updated_on');
  });

  it('assert :: invalid timestamps in the repository', () => {
    const assertValidationError = (table: DatabaseTable, message: string) => {
      throws(
        () => validateRepository(getTableRepository([table])),
        (error: MigrationTimestampsError) => {
          equal(error.message, message);
          return true;
        }
      );
    };

    const properties: ObjectSchemaProperties = {
      id: { type: SchemaType.String, format: 'date-time' },
      date: { type: SchemaType.String, format: 'date' },
      optional: { type: SchemaType.String, format: 'date-time', optional: true },
      updated_at: { type: SchemaType.String, format: 'date-time' }
    };

    assertValidationError(
      getTable('table', { updated: 'missing' }, { properties }),
      `Table table has no column missing for its updated timestamp.`
    );

    assertValidationError(
      getTable('table', { created: 'date' }, { properties }),
      `Table table has its created timestamp in date, which isn't a date-time.`
    );

    assertValidationError(
      getTable('table', { updated: 'optional' }, { properties }),
      `Table table has its updated timestamp in optional, which is optional or nullable.`
    );

    assertValidationError(
      getTable('table', { created: 'id' }, { properties }),
      `Table table has its created timestamp in id, which is in the primary key.`
    );

    assertValidationError(
      getTable('table', { created: 'updated_at', updated: 'updated_at' }, { properties }),
      `Table table has both timestamps in updated_at.`
    );

    assertValidationError(
      getTable('table', { updated: 'updated_at' }, { properties, renamedFrom: { columns: { updated_at: 'modified_at' } } }),
      `Table table renames updated_at, which is a timestamp: the rename needs a deploy without timestamps on the column.`
    );

    assertValidationError(
      getTable(
        'table',
        { updated: 'x'.repeat(54) },
        { properties: { ...properties, ['x'.repeat(54)]: { type: SchemaType.String, format: 'date-time' } } }
      ),
      `Table table has its updated timestamp in ${'x'.repeat(54)}, whose trigger name is longer than 63 bytes.`
    );

    validateRepository(getTableRepository([getTable('table', both)]));
  });

  it('assert :: warnings of a table gaining timestamps', () => {
    const indexes: TableIndex[] = [
      { name: 'updated_at', type: Index.Secondary, columns: ['updated_at'] },
      { name: 'name', type: Index.Secondary, columns: ['name'], options: { include: ['updated_at'] } },
      { name: 'created_at', type: Index.Secondary, columns: ['created_at'] }
    ];

    const source = getTableRepository([getTable('table', undefined, { indexes })]);
    const target = getTableRepository([getTable('table', both, { indexes }), getTable('other', both, { indexes })]);

    deepEqual(getMigrationWarnings(target, source), [
      `Timestamps on table: setting the column defaults takes an ACCESS EXCLUSIVE lock on it and creating the trigger a SHARE ROW EXCLUSIVE lock, each held briefly after waiting for the transactions running on it.`,
      `Index table.updated_at includes updated_at, which every update now writes, so updates on table can't be HOT.`,
      `Index table.name includes updated_at, which every update now writes, so updates on table can't be HOT.`,
      `Index other.updated_at includes updated_at, which every update now writes, so updates on other can't be HOT.`,
      `Index other.name includes updated_at, which every update now writes, so updates on other can't be HOT.`
    ]);

    // Nothing new on a table that already had them.
    deepEqual(getMigrationWarnings(target, target), []);
  });
});
