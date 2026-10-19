import type { PgIndexRepository, PgTableIndex } from '@ez4/pgclient/library';
import type { ObjectComparison } from '@ez4/utils';
import type { ObjectSchema } from '@ez4/schema';
import type { SqlBuilder } from '@ez4/pgsql';
import type { PgMigrationQueries } from '../types/query';

import { SchemaType } from '@ez4/schema';
import { Index } from '@ez4/database';
import { deepEqual } from '@ez4/utils';

import { getPrimaryKeyName, getSecondaryKeyName, getUniqueKeyName } from '../utils/naming';

import {
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
      const { columns, type, name: indexName } = indexes[indexKey];

      switch (type) {
        default:
          throw new Error(`Unsupported index type.`);

        case Index.Primary: {
          const name = getPrimaryKeyName(table, indexName);

          statements.constraints.push({
            check: getCheckConstraintExistsQuery(builder, name),
            query: builder.table(table).alter().existing().constraint(name).primary(columns).build()
          });

          break;
        }

        case Index.Unique: {
          const name = getUniqueKeyName(table, indexName);
          const type = getIndexType(columns, schema);

          statements.indexes.push(getRebuildStatement(builder, name), {
            assert: getCheckUniqueRecordsQuery(builder, table, columns),
            query: builder.index(name).create(table, columns).type(type).unique().concurrent().missing().build(),
            name
          });

          statements.validations.push({
            check: getIndexInvalidQuery(builder, name),
            retry: getCheckRunningValidationQuery(builder, name),
            name
          });

          break;
        }

        case Index.Secondary: {
          const name = getSecondaryKeyName(table, indexName);
          const type = getIndexType(columns, schema);

          statements.indexes.push(getRebuildStatement(builder, name), {
            query: builder.index(name).create(table, columns).type(type).concurrent().missing().build()
          });

          statements.validations.push({
            check: getIndexInvalidQuery(builder, name),
            retry: getCheckRunningValidationQuery(builder, name),
            name
          });

          break;
        }
      }
    }

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

    combineQueries(steps.rollout, prepareRenameColumns(builder, table, targetIndexes, renamedKeys));
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

    const temporaryName = getPrimaryKeyName(table, `${targetKey.name}_tmp`);

    steps.rollout.indexes.push(getRebuildStatement(builder, temporaryName), {
      assert: getCheckUniqueRecordsQuery(builder, table, targetKey.columns),
      query: builder.index(temporaryName).create(table, targetKey.columns).type('BTREE').unique().concurrent().missing().build(),
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

    const targetName = getPrimaryKeyName(table, targetKey.name);

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

  const isSameIndex = (sourceIndex: PgTableIndex, targetIndex: PgTableIndex, renamedColumns: Record<string, string>) => {
    const sourceColumns = sourceIndex.columns.map((column) => renamedColumns[column] ?? column);

    return sourceIndex.type === targetIndex.type && deepEqual(sourceColumns, targetIndex.columns);
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

    const temporaryIndex = { ...targetIndex, name: `${targetIndex.name}_tmp` };

    const temporaryName = getIndexName(table, temporaryIndex);
    const sourceName = getIndexName(table, sourceIndex);

    combineQueries(steps.rollout, prepareCreate(builder, table, schema, { [temporaryIndex.name]: temporaryIndex }));

    // Once the temporary index is renamed, the index with the current name is the new one.
    steps.cleanup.indexes.push(
      {
        check: getCheckIndexMissingQuery(builder, temporaryName),
        query: builder.index(sourceName).drop().existing().concurrent().build()
      },
      {
        query: builder.index(temporaryName).rename(getIndexName(table, targetIndex)).existing().build()
      }
    );

    return steps;
  };

  const getPrimaryIndex = (indexes: PgIndexRepository) => {
    return Object.values(indexes).find(({ type }) => type === Index.Primary);
  };

  const getIndexName = (table: string, index: PgTableIndex) => {
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
      query: builder.index(name).drop().existing().concurrent().build()
    };
  };

  const getIndexSteps = (): IndexMigrationSteps => {
    return {
      rollout: { constraints: [], validations: [], indexes: [] },
      cleanup: { constraints: [], validations: [], indexes: [] }
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
    const statements: IndexMigrationQueries = {
      validations: [],
      constraints: [],
      indexes: []
    };

    for (const indexKey in indexes) {
      const { type, name: indexName } = indexes[indexKey];

      switch (type) {
        default:
          throw new Error(`Unsupported index type.`);

        case Index.Primary: {
          const fromName = getPrimaryKeyName(fromTable, indexName);
          const toName = getPrimaryKeyName(toTable, indexName);

          statements.constraints.push({
            check: getCheckConstraintExistsQuery(builder, toName),
            query: builder.table(toTable).alter().existing().constraint(fromName).rename(toName).build()
          });

          break;
        }

        case Index.Unique: {
          const fromName = getUniqueKeyName(fromTable, indexName);
          const toName = getUniqueKeyName(toTable, indexName);

          statements.indexes.push({
            query: builder.index(fromName).rename(toName).existing().build()
          });

          break;
        }

        case Index.Secondary: {
          const fromName = getSecondaryKeyName(fromTable, indexName);
          const toName = getSecondaryKeyName(toTable, indexName);

          statements.indexes.push({
            query: builder.index(fromName).rename(toName).existing().build()
          });

          break;
        }
      }
    }

    return statements;
  };

  export const prepareRenameColumns = (builder: SqlBuilder, table: string, indexes: PgIndexRepository, changes: Record<string, string>) => {
    const statements: IndexMigrationQueries = {
      validations: [],
      constraints: [],
      indexes: []
    };

    for (const fromIndex in changes) {
      const toIndex = changes[fromIndex];

      const { type } = indexes[toIndex];

      switch (type) {
        default:
          throw new Error(`Unsupported index type.`);

        case Index.Primary: {
          const oldName = getPrimaryKeyName(table, fromIndex);
          const newName = getPrimaryKeyName(table, toIndex);

          statements.constraints.push({
            check: getCheckConstraintExistsQuery(builder, newName),
            query: builder.table(table).alter().existing().constraint(oldName).rename(newName).build()
          });

          break;
        }

        case Index.Unique: {
          const oldName = getUniqueKeyName(table, fromIndex);
          const newName = getUniqueKeyName(table, toIndex);

          statements.indexes.push({
            query: builder.index(oldName).rename(newName).existing().build()
          });

          break;
        }

        case Index.Secondary: {
          const oldName = getSecondaryKeyName(table, fromIndex);
          const newName = getSecondaryKeyName(table, toIndex);

          statements.indexes.push({
            query: builder.index(oldName).rename(newName).existing().build()
          });

          break;
        }
      }
    }

    return statements;
  };

  export const prepareDelete = (builder: SqlBuilder, table: string, indexes: PgIndexRepository) => {
    const statements: IndexMigrationQueries = {
      validations: [],
      constraints: [],
      indexes: []
    };

    for (const indexKey in indexes) {
      const { type, name: indexName } = indexes[indexKey];

      switch (type) {
        default:
          throw new Error(`Unsupported index type.`);

        case Index.Primary: {
          const name = getPrimaryKeyName(table, indexName);
          const query = builder.table(table).alter().existing().constraint(name).drop().existing();

          statements.constraints.push({
            query: query.build()
          });

          break;
        }

        case Index.Unique: {
          const name = getUniqueKeyName(table, indexName);
          const query = builder.index(name).drop().existing().concurrent();

          statements.indexes.push({
            query: query.build()
          });

          break;
        }

        case Index.Secondary: {
          const name = getSecondaryKeyName(table, indexName);
          const query = builder.index(name).drop().existing().concurrent();

          statements.indexes.push({
            query: query.build()
          });

          break;
        }
      }
    }

    return statements;
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
