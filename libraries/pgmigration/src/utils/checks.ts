import type { SqlBuilder, SqlFilters } from '@ez4/pgsql';

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
