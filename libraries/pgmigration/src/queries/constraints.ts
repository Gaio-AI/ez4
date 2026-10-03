import type { AnySchema, EnumSchema, ObjectSchema, ScalarSchema } from '@ez4/schema';
import type { SqlBuilder, SqlFilters } from '@ez4/pgsql';
import type { ObjectComparison } from '@ez4/utils';
import type { PgMigrationQueries } from '../types/query';

import { isEnumSchema, isScalarSchema, SchemaType } from '@ez4/schema';
import { escapeSqlText } from '@ez4/pgsql';
import { isNotNullish } from '@ez4/utils';

import { getConstraintName } from '../utils/naming';

import {
  getCheckConstraintExistsQuery,
  getCheckConstraintMissingQuery,
  getCheckConstraintRecordsQuery,
  getCheckConstraintInvalidQuery,
  getCheckRunningValidationQuery,
  getCheckConstraintValidQuery
} from '../utils/checks';

type ConstraintQueries = Pick<PgMigrationQueries, 'constraints' | 'validations'>;

export namespace ConstraintQuery {
  export const prepareCreate = (builder: SqlBuilder, table: string, columns: Record<string, AnySchema>) => {
    const statements: ConstraintQueries = {
      constraints: [],
      validations: []
    };

    for (const columnName in columns) {
      const columnSchema = columns[columnName];

      if (isEnumSchema(columnSchema) || (isScalarSchema(columnSchema) && isNotNullish(columnSchema.definitions?.value))) {
        const filters = getConstraintFilters(builder, columnName, columnSchema);
        const name = getConstraintName(table, columnName);

        statements.constraints.push(
          {
            check: getCheckConstraintExistsQuery(builder, name),
            assert: getCheckConstraintRecordsQuery(builder, table, filters),
            query: getCreateQuery(builder, table, name, filters).build(),
            name
          },
          {
            check: getCheckConstraintValidQuery(builder, name),
            query: getValidateQuery(builder, table, name).build()
          }
        );

        statements.validations.push({
          check: getCheckConstraintInvalidQuery(builder, name),
          retry: getCheckRunningValidationQuery(builder, name),
          name
        });
      }
    }

    return statements;
  };

  export const prepareUpdate = (
    builder: SqlBuilder,
    table: string,
    targetSchema: ObjectSchema,
    sourceSchema: ObjectSchema,
    changes: Record<string, ObjectComparison>
  ) => {
    const steps = {
      rollout: { validations: [], constraints: [] } as ConstraintQueries,
      cleanup: { validations: [], constraints: [] } as ConstraintQueries
    };

    for (const columnName in changes) {
      const sourceColumn = sourceSchema.properties[columnName];
      const targetColumn = targetSchema.properties[columnName];

      const sourceValues = getConstraintValues(sourceColumn);
      const targetValues = getConstraintValues(targetColumn);

      const switchValues = getSwitchValues(sourceColumn, targetColumn);

      // Rollout runs before the new code goes live, so it widens the check to the values both
      // versions of the code write.
      if (!isSameValues(switchValues, sourceValues)) {
        if (switchValues) {
          prepareSwap(builder, steps.rollout, table, columnName, getValueListFilters(builder, columnName, switchValues));
        } else {
          steps.rollout.constraints.push({
            query: getDeleteQuery(builder, table, getConstraintName(table, columnName)).build()
          });
        }
      }

      // Cleanup runs after the old code is gone, so the check narrows to the new values only there.
      if (isConstrainedSchema(targetColumn) && !isSameValues(targetValues, switchValues)) {
        prepareSwap(builder, steps.cleanup, table, columnName, getConstraintFilters(builder, columnName, targetColumn));
      }
    }

    return steps;
  };

  export const prepareRenameTable = (builder: SqlBuilder, fromTable: string, toTable: string, columns: Record<string, AnySchema>) => {
    const statements = [];

    for (const columnName in columns) {
      const columnSchema = columns[columnName];

      if (isConstrainedSchema(columnSchema)) {
        const oldName = getConstraintName(fromTable, columnName);
        const newName = getConstraintName(toTable, columnName);

        const query = builder.table(toTable).alter().existing().constraint(oldName).rename(newName);

        statements.push({
          check: getCheckConstraintExistsQuery(builder, newName),
          query: query.build()
        });
      }
    }

    return statements;
  };

  export const prepareRenameColumns = (builder: SqlBuilder, table: string, columnSchema: ObjectSchema, changes: Record<string, string>) => {
    const statements = [];

    for (const fromColumn in changes) {
      const toColum = changes[fromColumn];
      const toSchema = columnSchema.properties[toColum];

      if (isConstrainedSchema(toSchema)) {
        const oldName = getConstraintName(table, fromColumn);
        const newName = getConstraintName(table, toColum);

        const query = builder.table(table).alter().existing().constraint(oldName).rename(newName);

        statements.push({
          check: getCheckConstraintExistsQuery(builder, newName),
          query: query.build()
        });
      }
    }

    return statements;
  };

  export const prepareDelete = (builder: SqlBuilder, table: string, columns: Record<string, AnySchema>) => {
    const statements = [];

    for (const columnName in columns) {
      const columnSchema = columns[columnName];

      if (isConstrainedSchema(columnSchema)) {
        const name = getConstraintName(table, columnName);

        statements.push({
          query: getDeleteQuery(builder, table, name).build()
        });
      }
    }

    return statements;
  };

  // The new check is created and validated under a temporary name, and it replaces the current one
  // only once validated: while a validation is still running (or has failed) the current check
  // stays and the step fails, and a step run again skips whatever is already done.
  const prepareSwap = (builder: SqlBuilder, statements: ConstraintQueries, table: string, column: string, filters: SqlFilters) => {
    const tmpName = getConstraintName(table, `${column}_tmp`);
    const newName = getConstraintName(table, column);

    statements.constraints.push(
      {
        check: getCheckConstraintExistsQuery(builder, tmpName),
        assert: getCheckConstraintRecordsQuery(builder, table, filters),
        query: getCreateQuery(builder, table, tmpName, filters).build(),
        name: newName
      },
      {
        check: getCheckConstraintValidQuery(builder, tmpName),
        query: getValidateQuery(builder, table, tmpName).build()
      },
      {
        check: getCheckConstraintMissingQuery(builder, tmpName),
        assert: getCheckConstraintInvalidQuery(builder, tmpName),
        query: getDeleteQuery(builder, table, newName).build(),
        name: tmpName
      },
      {
        check: getCheckConstraintMissingQuery(builder, tmpName),
        assert: getCheckConstraintInvalidQuery(builder, tmpName),
        query: builder.table(table).alter().existing().constraint(tmpName).rename(newName).build(),
        name: tmpName
      }
    );

    statements.validations.push({
      check: getCheckConstraintInvalidQuery(builder, tmpName),
      retry: getCheckRunningValidationQuery(builder, tmpName),
      name: newName
    });
  };

  const getDeleteQuery = (builder: SqlBuilder, table: string, name: string) => {
    return builder.table(table).alter().existing().constraint(name).drop().existing();
  };

  const getValidateQuery = (builder: SqlBuilder, table: string, name: string) => {
    return builder.table(table).alter().existing().constraint(name).validate();
  };

  const getCreateQuery = (builder: SqlBuilder, table: string, name: string, filters: SqlFilters) => {
    const query = builder.table(table).alter().existing().constraint(name);

    query.check(filters).validate(false);

    return query;
  };

  const getConstraintFilters = (builder: SqlBuilder, column: string, schema: EnumSchema | ScalarSchema) => {
    const values = getConstraintValues(schema) ?? [];

    if (isEnumSchema(schema)) {
      return getValueListFilters(builder, column, values);
    }

    const [value] = values;

    return {
      [column]: {
        equal: builder.rawValue(value)
      }
    };
  };

  const getValueListFilters = (builder: SqlBuilder, column: string, values: string[]) => {
    return {
      [column]: {
        isIn: values.map((value) => builder.rawValue(value))
      }
    };
  };

  // The allowed values as the SQL literals of the check, so they compare the way the check does (an
  // enum option 1 is the text '1') and build its value list.
  const getConstraintValues = (schema: AnySchema) => {
    switch (schema.type) {
      case SchemaType.Enum: {
        return schema.options.map(({ value }) => escapeSqlText(`${value}`));
      }

      case SchemaType.Boolean:
      case SchemaType.Number: {
        const value = schema.definitions?.value;

        return isNotNullish(value) ? [`${value}`] : undefined;
      }

      case SchemaType.String: {
        const value = schema.definitions?.value;

        return isNotNullish(value) ? [escapeSqlText(value)] : undefined;
      }
    }

    return undefined;
  };

  // While the old and the new code are both live, the column accepts the values of either one, and
  // values of different types can't share a check, so the column has none then.
  const getSwitchValues = (sourceSchema: AnySchema, targetSchema: AnySchema) => {
    const sourceValues = getConstraintValues(sourceSchema);
    const targetValues = getConstraintValues(targetSchema);

    if (!sourceValues || !targetValues || sourceSchema.type !== targetSchema.type) {
      return undefined;
    }

    const removedValues = sourceValues.filter((value) => !targetValues.includes(value));

    return [...targetValues, ...removedValues];
  };

  // Checks are compared by their values as sets, so reordering the options keeps the check.
  const isSameValues = (values: string[] | undefined, otherValues: string[] | undefined) => {
    if (!values || !otherValues) {
      return values === otherValues;
    }

    return values.every((value) => otherValues.includes(value)) && otherValues.every((value) => values.includes(value));
  };

  const isConstrainedSchema = (schema: AnySchema): schema is EnumSchema | ScalarSchema => {
    return isEnumSchema(schema) || (isScalarSchema(schema) && isNotNullish(schema.definitions?.value));
  };
}
