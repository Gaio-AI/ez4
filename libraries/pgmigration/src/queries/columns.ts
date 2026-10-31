import type { PgIndexRepository } from '@ez4/pgclient/library';
import type { TableTimestamps } from '@ez4/database/library';
import type { AnySchema, ObjectSchema } from '@ez4/schema';
import type { ObjectComparison } from '@ez4/utils';
import type { SqlBuilder } from '@ez4/pgsql';

import { getTimestampColumns } from '@ez4/pgclient/library';
import { isAnyNumber, isNotNullish } from '@ez4/utils';
import { Index } from '@ez4/database';

import { getColumnDefault, getColumnType, isOptionalColumn } from '../utils/columns';
import { getCheckColumnExistsQuery } from '../utils/checks';

export namespace ColumnQuery {
  export const prepareCreate = (
    builder: SqlBuilder,
    table: string,
    indexes: PgIndexRepository,
    columns: Record<string, AnySchema>,
    timestamps?: TableTimestamps
  ) => {
    const statement = builder.table(table).alter().existing();

    const timestampColumns = getTimestampColumns(timestamps);

    for (const columnName in columns) {
      const columnSchema = columns[columnName];

      const columnIndexType = indexes[columnName]?.type;
      const columnIsPrimary = columnIndexType === Index.Primary;

      const columnRequired = !isOptionalColumn(columnSchema);
      const columnType = getColumnType(columnSchema, columnIsPrimary);
      const columnValue = getColumnDefault(columnSchema, columnIsPrimary, timestampColumns.includes(columnName));

      statement.add(columnName, columnType, columnRequired, columnValue).missing();
    }

    return {
      query: statement.build()
    };
  };

  export const prepareUpdate = (
    builder: SqlBuilder,
    table: string,
    schema: ObjectSchema,
    indexes: PgIndexRepository,
    changes: Record<string, ObjectComparison>,
    timestamps?: TableTimestamps
  ) => {
    const statements = [];

    const timestampColumns = getTimestampColumns(timestamps);

    for (const columnName in changes) {
      const { create, update, nested, remove } = changes[columnName];

      const columnSchema = schema.properties[columnName];

      const columnIndexType = indexes[columnName]?.type;
      const columnIsPrimary = columnIndexType === Index.Primary;
      const columnIsTimestamp = timestampColumns.includes(columnName);

      const query = builder.table(table).alter().existing().column(columnName);

      const attributeChanges = [create, update, remove];

      const definitionChanges = [
        create?.definitions,
        update?.definitions,
        remove?.definitions,
        nested?.definitions?.create,
        nested?.definitions?.update,
        nested?.definitions?.remove,
        nested?.definitions?.nested
      ];

      const hasTypeChanged = attributeChanges.some((change) => change?.type || change?.format);
      const hasNullityChanged = attributeChanges.some((change) => isNotNullish(change?.optional ?? change?.nullable));

      const hasDefaultChanged = definitionChanges.some((change) => change?.default !== undefined);
      const hasLengthChanged = definitionChanges.some((change) => isAnyNumber(change?.maxLength));

      if (hasTypeChanged || hasLengthChanged) {
        const columnType = getColumnType(columnSchema, false);

        // An explicit cast to varchar(n) truncates longer values, while the assignment cast rejects
        // them, and every type has an assignment cast to a string type.
        query.type(columnType, !columnType.startsWith('varchar('));
      }

      if (!columnIsPrimary && hasNullityChanged) {
        query.optional(isOptionalColumn(columnSchema));
      }

      if (hasDefaultChanged) {
        const isDefaultRemoved = remove?.definitions?.default !== undefined || nested?.definitions?.remove?.default !== undefined;

        query.default(isDefaultRemoved && !columnIsTimestamp ? null : getColumnDefault(columnSchema, columnIsPrimary, columnIsTimestamp));
      }

      if (!query.empty) {
        statements.push({
          check: getCheckColumnExistsQuery(builder, table, columnName),
          query: query.build()
        });
      }
    }

    return statements;
  };

  export const prepareRename = (builder: SqlBuilder, table: string, changes: Record<string, string>) => {
    const statements = [];

    for (const fromColumn in changes) {
      const toColum = changes[fromColumn];

      const statement = builder.table(table).alter().existing().rename(fromColumn, toColum);

      statements.push({
        check: getCheckColumnExistsQuery(builder, table, fromColumn),
        query: statement.build()
      });
    }

    return statements;
  };

  export const prepareDelete = (builder: SqlBuilder, table: string, columns: Record<string, AnySchema>) => {
    const statement = builder.table(table).alter().existing();

    for (const columnName in columns) {
      statement.drop(columnName).existing();
    }

    return {
      query: statement.build()
    };
  };
}
