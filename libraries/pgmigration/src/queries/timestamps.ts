import type { PgIndexRepository, PgTableRepository } from '@ez4/pgclient/library';
import type { TableTimestamps } from '@ez4/database/library';
import type { ObjectSchema } from '@ez4/schema';
import type { SqlBuilder } from '@ez4/pgsql';
import type { PgMigrationStatement } from '../types/query';

import { getTimestampColumns } from '@ez4/pgclient/library';
import { deepEqual, isAnyString } from '@ez4/utils';
import { escapeSqlName } from '@ez4/pgsql';
import { Index } from '@ez4/database';

import { MigrationTimestampsError } from '../errors/timestamps';
import { getColumnDefault, TIMESTAMP_VALUE } from '../utils/columns';
import { getCheckTriggerExistsQuery } from '../utils/checks';
import { getDollarQuoteTag } from '../utils/lock';

type TimestampSteps = {
  prepare: PgMigrationStatement[];
  cleanup: PgMigrationStatement[];
};

export namespace TimestampQuery {
  /**
   * The name of the trigger that writes the update timestamp `column`, and of the function it runs. Tables with the
   * same update column share the function, and a trigger name is unique within its table only.
   */
  export const getStampName = (column: string) => {
    return `ez4_stamp_${column}`;
  };

  /**
   * The update columns whose functions the given tables run.
   */
  export const getFunctionColumns = (tables: PgTableRepository) => {
    return new Set(
      Object.values(tables)
        .map(({ timestamps }) => timestamps?.updated)
        .filter(isAnyString)
    );
  };

  /**
   * Statements for new tables: the function of each update column once, then the trigger of each table. The create
   * table gives the timestamp columns their default.
   */
  export const prepareCreate = (builder: SqlBuilder, tables: PgTableRepository) => {
    const functions = [...getFunctionColumns(tables)].map((column) => prepareFunctionCreate(column));

    const triggers = Object.values(tables).flatMap(({ name, timestamps }) => {
      return timestamps?.updated ? [prepareTriggerCreate(builder, name, timestamps.updated)] : [];
    });

    return [...functions, ...triggers];
  };

  /**
   * Statements for tables in both repositories whose timestamps change. What a table gains runs before the new
   * code (prepare), under the name the table has then: the function (unless `functions` holds it already), the
   * column defaults and the trigger. What it loses runs once the old code is gone (cleanup): the trigger, then the
   * defaults the columns declare, and the function after the last trigger running it. A removed table drops its
   * trigger before the function too, since the table itself is only dropped after it.
   */
  export const prepareUpdate = (
    builder: SqlBuilder,
    target: PgTableRepository,
    source: PgTableRepository,
    removed: PgTableRepository,
    functions: Set<string>
  ) => {
    const steps: TimestampSteps = {
      prepare: [],
      cleanup: []
    };

    const createdFunctions = new Set(functions);

    for (const table in target) {
      const sourceTable = source[table];
      const targetTable = target[table];

      if (!sourceTable || deepEqual(sourceTable.timestamps ?? {}, targetTable.timestamps ?? {})) {
        continue;
      }

      const sourceUpdated = sourceTable.timestamps?.updated;
      const targetUpdated = targetTable.timestamps?.updated;

      const sourceColumns = getTimestampColumns(sourceTable.timestamps);
      const targetColumns = getTimestampColumns(targetTable.timestamps);

      // A column added with the table gets its default from the add column.
      const gainedColumns = targetColumns.filter((column) => !sourceColumns.includes(column) && sourceTable.schema.properties[column]);

      // A column dropped with the table goes with its default.
      const lostColumns = sourceColumns.filter((column) => !targetColumns.includes(column) && targetTable.schema.properties[column]);

      if (targetUpdated && targetUpdated !== sourceUpdated && !createdFunctions.has(targetUpdated)) {
        steps.prepare.push(prepareFunctionCreate(targetUpdated));
        createdFunctions.add(targetUpdated);
      }

      if (gainedColumns.length) {
        steps.prepare.push(prepareDefaults(builder, sourceTable.name, gainedColumns));
      }

      if (targetUpdated && targetUpdated !== sourceUpdated) {
        steps.prepare.push(prepareTriggerCreate(builder, sourceTable.name, targetUpdated));
      }

      if (sourceUpdated && sourceUpdated !== targetUpdated) {
        steps.cleanup.push(prepareTriggerDelete(targetTable.name, sourceUpdated));
      }

      if (lostColumns.length) {
        steps.cleanup.push(prepareDefaultsRestore(builder, targetTable.name, targetTable.schema, targetTable.indexes, lostColumns));
      }
    }

    for (const table in removed) {
      const { name, timestamps } = removed[table];

      if (timestamps?.updated) {
        steps.cleanup.push(prepareTriggerDelete(name, timestamps.updated));
      }
    }

    const targetFunctions = getFunctionColumns(target);

    for (const column of getFunctionColumns(source)) {
      if (!targetFunctions.has(column)) {
        steps.cleanup.push(prepareFunctionDelete(column));
      }
    }

    return steps;
  };

  /**
   * Throws on a column rename that moves a timestamp column: the trigger writes the column by name, and between the
   * rename (rollout) and the trigger change (prepare or cleanup) every update of the table would fail.
   */
  export const validateRenames = (
    table: string,
    source: TableTimestamps | undefined,
    target: TableTimestamps | undefined,
    renames: Record<string, string>
  ) => {
    const sourceColumns = getTimestampColumns(source);
    const targetColumns = getTimestampColumns(target);

    for (const fromColumn in renames) {
      const toColumn = renames[fromColumn];

      if (sourceColumns.includes(fromColumn) || targetColumns.includes(toColumn)) {
        throw new MigrationTimestampsError(
          table,
          `renames ${fromColumn} to ${toColumn}, a timestamp column: drop the timestamps on the column, rename it and declare them again in separate deploys`
        );
      }
    }
  };

  const prepareFunctionCreate = (column: string): PgMigrationStatement => {
    const body = `BEGIN NEW.${escapeSqlName(column)} := ${TIMESTAMP_VALUE}; RETURN NEW; END`;
    const tag = getDollarQuoteTag(body, 'fn');

    return {
      query: `CREATE OR REPLACE FUNCTION ${escapeSqlName(getStampName(column))}() RETURNS trigger LANGUAGE plpgsql AS ${tag} ${body} ${tag}`
    };
  };

  // Restricted, so it fails instead of dropping a trigger the migration doesn't know about.
  const prepareFunctionDelete = (column: string): PgMigrationStatement => {
    return {
      query: `DROP FUNCTION IF EXISTS ${escapeSqlName(getStampName(column))}() RESTRICT`
    };
  };

  // Without a column list the trigger runs on every update, whatever columns it writes.
  const prepareTriggerCreate = (builder: SqlBuilder, table: string, column: string): PgMigrationStatement => {
    const name = getStampName(column);

    return {
      check: getCheckTriggerExistsQuery(builder, table, name),
      query: `CREATE TRIGGER ${escapeSqlName(name)} BEFORE UPDATE ON ${escapeSqlName(table)} FOR EACH ROW EXECUTE FUNCTION ${escapeSqlName(name)}()`
    };
  };

  const prepareTriggerDelete = (table: string, column: string): PgMigrationStatement => {
    return {
      query: `DROP TRIGGER IF EXISTS ${escapeSqlName(getStampName(column))} ON ${escapeSqlName(table)}`
    };
  };

  const prepareDefaults = (builder: SqlBuilder, table: string, columns: string[]): PgMigrationStatement => {
    const statement = builder.table(table).alter().existing();

    for (const column of columns) {
      statement.column(column).default(TIMESTAMP_VALUE);
    }

    return {
      query: statement.build()
    };
  };

  const prepareDefaultsRestore = (
    builder: SqlBuilder,
    table: string,
    schema: ObjectSchema,
    indexes: PgIndexRepository,
    columns: string[]
  ): PgMigrationStatement => {
    const statement = builder.table(table).alter().existing();

    for (const column of columns) {
      const isPrimary = indexes[column]?.type === Index.Primary;

      statement.column(column).default(getColumnDefault(schema.properties[column], isPrimary) ?? null);
    }

    return {
      query: statement.build()
    };
  };
}
