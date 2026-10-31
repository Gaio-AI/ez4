import type { PgIndexRepository, PgTableIndex } from '@ez4/pgclient/library';
import type { TableIndexFilters } from '@ez4/database/library';
import type { AnyObject, ObjectComparison } from '@ez4/utils';
import type { SqlBuilder, SqlFilters } from '@ez4/pgsql';
import type { ObjectSchema } from '@ez4/schema';
import type { PgMigrationQueries } from '../types/query';

import { SchemaType } from '@ez4/schema';
import { Index } from '@ez4/database';
import { escapeSqlText } from '@ez4/pgsql';
import { deepEqual, isAnyObject } from '@ez4/utils';

import { getPrimaryKeyName, getSecondaryKeyName, getTemporaryName, getUniqueKeyName } from '../utils/naming';

import {
  getCheckAnyQuery,
  getCheckConstraintExistsQuery,
  getCheckConstraintMissingQuery,
  getCheckIndexMissingQuery,
  getCheckIndexRebuildQuery,
  getCheckPrimaryKeySwappedQuery,
  getCheckRunningValidationQuery,
  getCheckUniqueRecordsQuery,
  getIndexInvalidQuery
} from '../utils/checks';

type IndexMigrationQueries = Pick<PgMigrationQueries, 'constraints' | 'validations' | 'indexes'>;

type IndexMigrationSteps = {
  rollout: IndexMigrationQueries;
  cleanup: IndexMigrationQueries;
};

export namespace IndexQueries {
  export const prepareCreate = (builder: SqlBuilder, table: string, schema: ObjectSchema, indexes: PgIndexRepository) => {
    const statements: IndexMigrationQueries = {
      constraints: [],
      validations: [],
      indexes: []
    };

    for (const indexKey in indexes) {
      const index = indexes[indexKey];

      switch (index.type) {
        default:
          throw new Error(`Unsupported index type.`);

        case Index.Primary: {
          const name = getPrimaryKeyName(table, index.name);

          statements.constraints.push({
            check: getCheckConstraintExistsQuery(builder, name),
            query: builder.table(table).alter().existing().constraint(name).primary(index.columns).build()
          });

          break;
        }

        case Index.Unique:
        case Index.Secondary: {
          combineQueries(statements, prepareIndex(builder, table, schema, index, getIndexName(table, index)));
          break;
        }
      }
    }

    return statements;
  };

  // Builds a unique or secondary index under the given name.
  const prepareIndex = (builder: SqlBuilder, table: string, schema: ObjectSchema, index: PgTableIndex, name: string) => {
    const statements: IndexMigrationQueries = {
      constraints: [],
      validations: [],
      indexes: []
    };

    const { columns, options } = index;

    const query = builder.index(name).create(table, columns).type(getIndexMethod(index, schema)).concurrent().missing();

    const where = options?.where && getIndexFilters(builder, options.where);

    if (where) {
      query.where(where);
    }

    if (options?.include) {
      query.include(options.include);
    }

    if (options?.order) {
      query.order(options.order);
    }

    if (index.type === Index.Unique) {
      if (options?.nullsNotDistinct) {
        query.nullsNotDistinct();
      }

      statements.indexes.push(getRebuildStatement(builder, name), {
        assert: getCheckUniqueRecordsQuery(builder, table, columns, { where, nullsNotDistinct: options?.nullsNotDistinct }),
        query: query.unique().build(),
        concurrent: true,
        name
      });
    } else {
      statements.indexes.push(getRebuildStatement(builder, name), {
        query: query.build(),
        concurrent: true
      });
    }

    statements.validations.push({
      check: getIndexInvalidQuery(builder, name),
      retry: getCheckRunningValidationQuery(builder, name),
      name
    });

    return statements;
  };

  /**
   * The index changes of a table that already exists. A new index is built before the one it replaces
   * goes, and that one goes in the cleanup, once the code that may rely on it (an upsert on a unique
   * index) is no longer live. A renamed column keeps its indexes, so an index that only follows that
   * rename is renamed instead of built again.
   */
  export const prepareChanges = (
    builder: SqlBuilder,
    table: string,
    schema: ObjectSchema,
    sourceIndexes: PgIndexRepository,
    targetIndexes: PgIndexRepository,
    changes: ObjectComparison,
    renamedColumns: Record<string, string>
  ) => {
    const steps = getIndexSteps();

    const createdKeys = new Set(Object.keys(changes.create ?? {}));
    const removedKeys = new Set(Object.keys(changes.remove ?? {}));
    const updatedKeys = Object.keys(changes.nested ?? {});

    const renamedKeys: Record<string, string> = {
      ...changes.rename
    };

    for (const removedKey of removedKeys) {
      const createdKey = [...createdKeys].find((indexKey) => {
        return isSameIndex(sourceIndexes[removedKey], targetIndexes[indexKey], renamedColumns);
      });

      if (createdKey) {
        renamedKeys[removedKey] = createdKey;

        removedKeys.delete(removedKey);
        createdKeys.delete(createdKey);
      }
    }

    combineQueries(steps.rollout, prepareRenameColumns(builder, table, sourceIndexes, targetIndexes, renamedKeys));
    combineQueries(steps.rollout, prepareCreate(builder, table, schema, getNonPrimaryIndexes(targetIndexes, createdKeys)));
    combineSteps(steps, prepareUpdate(builder, table, schema, sourceIndexes, targetIndexes, updatedKeys, renamedColumns));
    combineQueries(steps.cleanup, prepareDelete(builder, table, getNonPrimaryIndexes(sourceIndexes, removedKeys)));

    const isSourcePrimary = (indexKey: string) => sourceIndexes[indexKey].type === Index.Primary;
    const isTargetPrimary = (indexKey: string) => targetIndexes[indexKey].type === Index.Primary;

    const hasPrimaryKeyChange =
      [...createdKeys].some(isTargetPrimary) ||
      [...removedKeys].some(isSourcePrimary) ||
      updatedKeys.some((indexKey) => {
        const hasPrimaryKey = isSourcePrimary(indexKey) || isTargetPrimary(indexKey);

        return hasPrimaryKey && !isSameIndex(sourceIndexes[indexKey], targetIndexes[indexKey], renamedColumns);
      });

    if (hasPrimaryKeyChange) {
      combineSteps(steps, preparePrimaryKey(builder, table, getPrimaryIndex(sourceIndexes), getPrimaryIndex(targetIndexes)));
    }

    return steps;
  };

  const prepareUpdate = (
    builder: SqlBuilder,
    table: string,
    schema: ObjectSchema,
    sourceIndexes: PgIndexRepository,
    targetIndexes: PgIndexRepository,
    updatedKeys: string[],
    renamedColumns: Record<string, string>
  ) => {
    const steps = getIndexSteps();

    for (const indexKey of updatedKeys) {
      const sourceIndex = sourceIndexes[indexKey];
      const targetIndex = targetIndexes[indexKey];

      if (isSameIndex(sourceIndex, targetIndex, renamedColumns)) {
        continue;
      }

      const sourcePrimary = sourceIndex.type === Index.Primary;
      const targetPrimary = targetIndex.type === Index.Primary;

      if (!targetPrimary) {
        const sourceName = sourcePrimary ? undefined : getIndexName(table, sourceIndex);
        const targetName = getIndexName(table, targetIndex);

        if (sourceName === targetName) {
          combineSteps(steps, prepareReplace(builder, table, schema, sourceIndex, targetIndex));
          continue;
        }

        combineQueries(steps.rollout, prepareCreate(builder, table, schema, { [indexKey]: targetIndex }));
      }

      if (!sourcePrimary) {
        combineQueries(steps.cleanup, prepareDelete(builder, table, { [indexKey]: sourceIndex }));
      }
    }

    return steps;
  };

  /**
   * A table holds one primary key, so a new one can't be added next to the current one. Its index is
   * built concurrently under a temporary name in the rollout, and the cleanup swaps the constraints in
   * one statement that takes that index over, holding the table lock only for the swap itself. The new
   * key gets its name right after, so the table has a primary key all along.
   */
  const preparePrimaryKey = (builder: SqlBuilder, table: string, sourceKey?: PgTableIndex, targetKey?: PgTableIndex) => {
    const steps = getIndexSteps();

    if (!targetKey) {
      if (sourceKey) {
        const sourceName = getPrimaryKeyName(table, sourceKey.name);

        steps.cleanup.constraints.push({
          query: builder.table(table).alter().existing().constraint(sourceName).drop().existing().build()
        });
      }

      return steps;
    }

    const targetName = getPrimaryKeyName(table, targetKey.name);
    const temporaryName = getTemporaryName(targetName);

    steps.rollout.indexes.push(getRebuildStatement(builder, temporaryName), {
      assert: getCheckUniqueRecordsQuery(builder, table, targetKey.columns),
      query: builder.index(temporaryName).create(table, targetKey.columns).type('BTREE').unique().concurrent().missing().build(),
      concurrent: true,
      name: temporaryName
    });

    steps.rollout.validations.push({
      check: getIndexInvalidQuery(builder, temporaryName),
      retry: getCheckRunningValidationQuery(builder, temporaryName),
      name: temporaryName
    });

    const swapQuery = builder.table(table).alter().existing();

    if (sourceKey) {
      swapQuery.constraint(getPrimaryKeyName(table, sourceKey.name)).drop().existing();
    }

    swapQuery.constraint(temporaryName).primary(targetKey.columns).index(temporaryName);

    steps.cleanup.constraints.push(
      {
        check: getCheckPrimaryKeySwappedQuery(builder, temporaryName),
        query: swapQuery.build()
      },
      {
        check: getCheckConstraintMissingQuery(builder, temporaryName),
        query: builder.table(table).alter().existing().constraint(temporaryName).rename(targetName).build()
      }
    );

    return steps;
  };

  /**
   * Names of the indexes of a table, and of the constraints among them (the primary key is both).
   */
  export const getNames = (table: string, indexes: PgIndexRepository) => {
    const allIndexes = Object.values(indexes);

    return {
      constraints: allIndexes.filter(({ type }) => type === Index.Primary).map((index) => getIndexName(table, index)),
      indexes: allIndexes.map((index) => getIndexName(table, index))
    };
  };

  // The primary key is replaced on its own (see `preparePrimaryKey`), so it's left out of the other changes.
  const getNonPrimaryIndexes = (indexes: PgIndexRepository, indexKeys: Iterable<string>) => {
    const result: PgIndexRepository = {};

    for (const indexKey of indexKeys) {
      if (indexes[indexKey].type !== Index.Primary) {
        result[indexKey] = indexes[indexKey];
      }
    }

    return result;
  };

  // A renamed column keeps its place in the order, the included columns and the where of an index, as it does in
  // the key: the index is the same one, and only the column changes its name.
  const isSameIndex = (sourceIndex: PgTableIndex, targetIndex: PgTableIndex, renamedColumns: Record<string, string>) => {
    const renameColumn = (column: string) => renamedColumns[column] ?? column;

    const renameKeys = <T>(record: Record<string, T> | undefined) => {
      return record && Object.fromEntries(Object.entries(record).map(([column, value]) => [renameColumn(column), value]));
    };

    const { order, include, where, ...otherOptions } = sourceIndex.options ?? {};

    const sourceOptions = {
      ...otherOptions,
      ...(order && { order: renameKeys(order) }),
      ...(include && { include: include.map(renameColumn) }),
      ...(where && { where: renameKeys(where) })
    };

    return (
      sourceIndex.type === targetIndex.type &&
      deepEqual(sourceIndex.columns.map(renameColumn), targetIndex.columns) &&
      deepEqual(sourceOptions, targetIndex.options ?? {})
    );
  };

  // An index keeping its name (its columns changed, but not its type) is built aside under a temporary
  // name and takes the place of the current one in the cleanup.
  const prepareReplace = (
    builder: SqlBuilder,
    table: string,
    schema: ObjectSchema,
    sourceIndex: PgTableIndex,
    targetIndex: PgTableIndex
  ) => {
    const steps = getIndexSteps();

    const targetName = getIndexName(table, targetIndex);
    const temporaryName = getTemporaryName(targetName);

    combineQueries(steps.rollout, prepareIndex(builder, table, schema, targetIndex, temporaryName));

    // Once the temporary index is renamed, the index with the current name is the new one.
    combineQueries(steps.cleanup, prepareDropIndex(builder, table, sourceIndex, getCheckIndexMissingQuery(builder, temporaryName)));

    steps.cleanup.indexes.push({
      query: builder.index(temporaryName).rename(targetName).existing().build()
    });

    return steps;
  };

  const getPrimaryIndex = (indexes: PgIndexRepository) => {
    return Object.values(indexes).find(({ type }) => type === Index.Primary);
  };

  const getIndexName = (table: string, index: PgTableIndex) => {
    if (index.options?.name) {
      return index.options.name;
    }

    switch (index.type) {
      case Index.Primary:
        return getPrimaryKeyName(table, index.name);

      case Index.Unique:
        return getUniqueKeyName(table, index.name);

      default:
        return getSecondaryKeyName(table, index.name);
    }
  };

  const getRebuildStatement = (builder: SqlBuilder, name: string) => {
    return {
      check: getCheckIndexRebuildQuery(builder, name),
      query: builder.index(name).drop().existing().concurrent().build(),
      condition: 'only when the index is invalid',
      concurrent: true
    };
  };

  const getIndexQueries = (): IndexMigrationQueries => {
    return { constraints: [], validations: [], indexes: [] };
  };

  const getIndexSteps = (): IndexMigrationSteps => {
    return {
      rollout: getIndexQueries(),
      cleanup: getIndexQueries()
    };
  };

  const combineQueries = (target: IndexMigrationQueries, source: IndexMigrationQueries) => {
    target.constraints.push(...source.constraints);
    target.validations.push(...source.validations);
    target.indexes.push(...source.indexes);
  };

  const combineSteps = (target: IndexMigrationSteps, source: IndexMigrationSteps) => {
    combineQueries(target.rollout, source.rollout);
    combineQueries(target.cleanup, source.cleanup);
  };

  export const prepareRenameTable = (builder: SqlBuilder, fromTable: string, toTable: string, indexes: PgIndexRepository) => {
    const statements = getIndexQueries();

    for (const indexKey in indexes) {
      const index = indexes[indexKey];

      combineQueries(statements, prepareRename(builder, toTable, index, getIndexName(fromTable, index), getIndexName(toTable, index)));
    }

    return statements;
  };

  export const prepareRenameColumns = (
    builder: SqlBuilder,
    table: string,
    sourceIndexes: PgIndexRepository,
    targetIndexes: PgIndexRepository,
    changes: Record<string, string>
  ) => {
    const statements = getIndexQueries();

    for (const fromIndex in changes) {
      const sourceIndex = sourceIndexes[fromIndex];
      const targetIndex = targetIndexes[changes[fromIndex]];

      combineQueries(
        statements,
        prepareRename(builder, table, targetIndex, getIndexName(table, sourceIndex), getIndexName(table, targetIndex))
      );
    }

    return statements;
  };

  export const prepareDelete = (builder: SqlBuilder, table: string, indexes: PgIndexRepository) => {
    const statements = getIndexQueries();

    for (const indexKey in indexes) {
      const index = indexes[indexKey];
      const name = getIndexName(table, index);

      if (index.type === Index.Primary) {
        statements.constraints.push({
          query: builder.table(table).alter().existing().constraint(name).drop().existing().build()
        });
      } else {
        combineQueries(statements, prepareDropIndex(builder, table, index));
      }
    }

    return statements;
  };

  /**
   * A database created by an earlier version may hold a unique key as a constraint, and Postgres doesn't
   * drop the index of a constraint. When there is one, the constraint goes first and takes its index with
   * it, so the index drop that follows finds nothing. `skip` skips both, as the index drop's own check.
   */
  const prepareDropIndex = (builder: SqlBuilder, table: string, index: PgTableIndex, skip?: string) => {
    const statements = getIndexQueries();
    const name = getIndexName(table, index);

    if (index.type === Index.Unique) {
      statements.constraints.push({
        check: getCheckAnyQuery(skip, getCheckConstraintMissingQuery(builder, name)),
        query: builder.table(table).alter().existing().constraint(name).drop().existing().build()
      });
    }

    statements.indexes.push({
      ...(skip && { check: skip }),
      query: builder.index(name).drop().existing().concurrent().build(),
      concurrent: true
    });

    return statements;
  };

  // An index named apart from its table and columns keeps its name when they are renamed.
  const prepareRename = (builder: SqlBuilder, table: string, index: PgTableIndex, fromName: string, toName: string) => {
    const statements = getIndexQueries();

    if (fromName === toName) {
      return statements;
    }

    if (index.type === Index.Primary) {
      statements.constraints.push({
        check: getCheckConstraintExistsQuery(builder, toName),
        query: builder.table(table).alter().existing().constraint(fromName).rename(toName).build()
      });
    } else {
      statements.indexes.push({
        query: builder.index(fromName).rename(toName).existing().build()
      });
    }

    return statements;
  };

  /**
   * The literal predicate of a partial index: Postgres uses the index only for queries whose filters
   * imply it, which a parameter can't do.
   */
  const getIndexFilters = (builder: SqlBuilder, filters: TableIndexFilters): SqlFilters => {
    const result: AnyObject = {};

    for (const key in filters) {
      result[key] = getIndexFilterValue(builder, key, filters[key]);
    }

    return result;
  };

  const getIndexFilterValue = (builder: SqlBuilder, operator: string, value: unknown): unknown => {
    if (value === null || (typeof value === 'boolean' && operator === 'isNull')) {
      return value;
    }

    if (Array.isArray(value)) {
      return value.map((element) => getIndexFilterValue(builder, operator, element));
    }

    if (isAnyObject(value)) {
      return getIndexFilters(builder, value);
    }

    return builder.rawValue(typeof value === 'string' ? escapeSqlText(value) : `${value}`);
  };

  const getIndexMethod = (index: PgTableIndex, schema: ObjectSchema) => {
    return index.options?.method?.toUpperCase() ?? getIndexType(index.columns, schema);
  };

  const getIndexType = (columns: string[], schema: ObjectSchema) => {
    if (columns.length === 1) {
      const [firstColumn] = columns;

      const columnSchema = schema.properties[firstColumn];

      switch (columnSchema?.type) {
        case SchemaType.Object:
        case SchemaType.Union:
        case SchemaType.Array:
        case SchemaType.Tuple:
          return 'GIN';
      }
    }

    return 'BTREE';
  };
}
