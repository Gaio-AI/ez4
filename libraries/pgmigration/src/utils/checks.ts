import type { SqlBuilder, SqlFilters } from '@ez4/pgsql';

import { escapeSqlName } from '@ez4/pgsql';
import { isEmptyObject } from '@ez4/utils';

export const getCheckDatabaseExistsQuery = (builder: SqlBuilder, database: string) => {
  const [query] = builder
    .select()
    .rawColumn(1)
    .from('pg_database')
    .where({
      datname: builder.rawString(database)
    })
    .build();

  return query;
};

export const getCheckConstraintExistsQuery = (builder: SqlBuilder, name: string) => {
  const [query] = builder
    .select()
    .rawColumn(1)
    .from('pg_constraint')
    .where({
      conname: builder.rawString(name)
    })
    .build();

  return query;
};

export const getCheckTriggerExistsQuery = (builder: SqlBuilder, table: string, name: string) => {
  const [query] = builder
    .select()
    .rawColumn(1)
    .from('pg_trigger')
    .where({
      tgname: builder.rawString(name),
      tgrelid: builder.rawValue(`to_regclass(${builder.rawString(escapeSqlName(table)).build()})`)
    })
    .build();

  return query;
};

export const getCheckConstraintMissingQuery = (builder: SqlBuilder, name: string) => {
  const [query] = builder
    .select()
    .rawColumn(1)
    .where({
      NOT: {
        exists: builder
          .select()
          .rawColumn(1)
          .from('pg_constraint')
          .where({
            conname: builder.rawString(name)
          })
      }
    })
    .build();

  return query;
};

export const getCheckColumnExistsQuery = (builder: SqlBuilder, table: string, column: string) => {
  const [query] = builder
    .select()
    .rawColumn(1)
    .where({
      NOT: {
        exists: builder
          .select()
          .from(builder.rawValue('information_schema.columns'))
          .rawColumn(1)
          .where({
            column_name: builder.rawString(column),
            table_name: builder.rawString(table)
          })
      }
    })
    .build();

  return query;
};

export const getCheckConstraintInvalidQuery = (builder: SqlBuilder, name: string) => {
  const [query] = builder
    .select()
    .rawColumn(1)
    .from('pg_constraint')
    .where({
      convalidated: builder.rawValue('false'),
      conname: builder.rawString(name)
    })
    .build();

  return query;
};

export const getCheckConstraintValidQuery = (builder: SqlBuilder, name: string) => {
  const [query] = builder
    .select()
    .rawColumn(1)
    .from('pg_constraint')
    .where({
      convalidated: builder.rawValue('true'),
      conname: builder.rawString(name)
    })
    .build();

  return query;
};

export const getCheckConstraintRecordsQuery = (builder: SqlBuilder, table: string, filters: SqlFilters) => {
  const [query] = builder
    .select()
    .rawColumn(1)
    .from(table)
    .where({
      NOT: filters
    })
    .take(1)
    .build();

  return query;
};

export const getCheckRunningValidationQuery = (builder: SqlBuilder, name: string) => {
  const [query] = builder
    .select()
    .rawColumn(1)
    .from('pg_stat_activity')
    .where({
      state: builder.rawString('active'),
      // This query holds the name it looks for, so its own session is left out.
      pid: {
        not: builder.rawValue('pg_backend_pid()')
      },
      query: {
        contains: builder.rawString(`"${name}"`),
        insensitive: true
      }
    })
    .take(1)
    .build();

  return query;
};

export const getIndexInvalidQuery = (builder: SqlBuilder, name: string) => {
  const [query] = builder
    .select()
    .rawColumn(1)
    .from('pg_index')
    .where({
      indexrelid: builder.rawValue(`${builder.rawString(name).build()}::regclass`),
      OR: [
        {
          indisvalid: builder.rawValue('false')
        },
        {
          indisready: builder.rawValue('false')
        }
      ]
    })
    .build();

  return query;
};

// Skips the drop of an index unless a failed concurrent build left it invalid: `IF NOT EXISTS` would keep
// that index forever. One still being built is invalid too, and dropping it would only wait for the build.
export const getCheckIndexRebuildQuery = (builder: SqlBuilder, name: string) => {
  const invalidIndex = builder
    .select()
    .rawColumn(1)
    .from('pg_index')
    .where({
      indexrelid: builder.rawValue(`to_regclass(${builder.rawString(`"${name}"`).build()})`),
      OR: [
        {
          indisvalid: builder.rawValue('false')
        },
        {
          indisready: builder.rawValue('false')
        }
      ]
    });

  const runningBuild = builder
    .select()
    .rawColumn(1)
    .from('pg_stat_activity')
    .where({
      state: builder.rawString('active'),
      pid: {
        not: builder.rawValue('pg_backend_pid()')
      },
      query: {
        contains: builder.rawString(`"${name}"`),
        insensitive: true
      }
    });

  const [query] = builder
    .select()
    .rawColumn(1)
    .where({
      OR: [
        {
          NOT: {
            exists: invalidIndex
          }
        },
        {
          exists: runningBuild
        }
      ]
    })
    .build();

  return query;
};

export const getCheckIndexMissingQuery = (builder: SqlBuilder, name: string) => {
  const [query] = builder
    .select()
    .rawColumn(1)
    .where({
      NOT: {
        exists: builder
          .select()
          .rawColumn(1)
          .from('pg_class')
          .where({
            relname: builder.rawString(name),
            relkind: builder.rawString('i')
          })
      }
    })
    .build();

  return query;
};

// The swap takes the temporary index over as a constraint of the same name, and renaming that constraint
// renames the index too: either way the swap already ran.
export const getCheckPrimaryKeySwappedQuery = (builder: SqlBuilder, name: string) => {
  const [query] = builder
    .select()
    .rawColumn(1)
    .where({
      OR: [
        {
          exists: builder
            .select()
            .rawColumn(1)
            .from('pg_constraint')
            .where({
              conname: builder.rawString(name)
            })
        },
        {
          NOT: {
            exists: builder
              .select()
              .rawColumn(1)
              .from('pg_class')
              .where({
                relname: builder.rawString(name),
                relkind: builder.rawString('i')
              })
          }
        }
      ]
    })
    .build();

  return query;
};

/**
 * Finds records that the unique index would take as duplicates: among the ones the index covers (its
 * `where`), and, unless nulls are not distinct, leaving out those with a null column.
 */
export const getCheckUniqueRecordsQuery = (
  builder: SqlBuilder,
  table: string,
  columns: string[],
  options?: { where?: SqlFilters; nullsNotDistinct?: boolean }
) => {
  const columnFilters = columns.reduce<SqlFilters>((filters, column) => {
    if (!options?.nullsNotDistinct) {
      filters[column] = { isNull: false };
    }

    return filters;
  }, {});

  const filters: SqlFilters =
    options?.where && !isEmptyObject(columnFilters) ? { AND: [options.where, columnFilters] } : (options?.where ?? columnFilters);

  const [query] = builder
    .select()
    .rawColumn(1)
    .from(table)
    .where(filters)
    .group(...columns)
    .having({
      '*': {
        count: true,
        gt: builder.rawValue('1')
      }
    })
    .take(1)
    .build();

  return query;
};

/**
 * Skips a statement when any of the checks finds a row.
 */
export const getCheckAnyQuery = (...checks: (string | undefined)[]) => {
  const queries = checks.filter((check) => check !== undefined);

  return queries.length > 1 ? `SELECT 1 WHERE ${queries.map((query) => `EXISTS (${query})`).join(' OR ')}` : queries[0];
};

/**
 * Skips a statement only when every check finds a row.
 */
export const getCheckAllQuery = (...checks: string[]) => {
  return checks.length > 1 ? `SELECT 1 WHERE ${checks.map((query) => `EXISTS (${query})`).join(' AND ')}` : checks[0];
};

export type ForeignKeyDefinition = {
  columns: string[];
  table: string;
  tableColumns: string[];
  deleteAction: 'c' | 'n' | 'r' | 'a';
};

/**
 * Finds the foreign key of the given name when it's already valid and made as given: the same columns,
 * the same table and columns it references, cascading updates and the same delete action. Postgres can't
 * change a key's delete action in place, so a key the catalog already holds as given needs no new one, nor
 * the validation that reads the whole table for it.
 */
export const getCheckForeignKeyMatchesQuery = (builder: SqlBuilder, name: string, definition: ForeignKeyDefinition) => {
  const { columns, table, tableColumns, deleteAction } = definition;

  const literal = (value: string) => builder.rawString(value).build();

  // Built with `quote_ident`, so the identifiers are quoted the way `pg_get_constraintdef` prints them.
  const identifiers = (values: string[]) => values.map((value) => `quote_ident(${literal(value)})`).join(` || ', ' || `);

  const keyDefinition = `'FOREIGN KEY (' || ${identifiers(columns)} || ') REFERENCES ' || ${identifiers([table])} || '(' || ${identifiers(tableColumns)} || ')'`;

  return [
    `SELECT 1 FROM "pg_constraint" WHERE "conname" = ${literal(name)}`,
    `"contype" = 'f'`,
    `"convalidated"`,
    `"confupdtype" = 'c'`,
    `"confdeltype" = ${literal(deleteAction)}`,
    `starts_with(pg_get_constraintdef("oid"), ${keyDefinition})`
  ].join(' AND ');
};
