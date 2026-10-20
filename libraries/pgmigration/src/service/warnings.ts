import type { PgIndexRepository, PgRelationMetadata, PgTableRepository } from '@ez4/pgclient/library';
import type { TableIndexFilters } from '@ez4/database/library';

import { deepEqual, isAnyObject } from '@ez4/utils';
import { Index } from '@ez4/database';

import { getTableRepositoryChanges } from '../utils/repository';
import { RelationQuery } from '../queries/relations';

/**
 * What the deploy plan warns about the migration from the source to the target repository.
 */
export const getMigrationWarnings = (target: PgTableRepository, source: PgTableRepository) => {
  const foreignKeyWarnings = getUnindexedForeignKeys(target, source).map(({ table, column, sourceTable }) => {
    return `Foreign key ${table}.${column} has no index led by ${column}: deleting or updating a record of ${sourceTable} scans ${table}.`;
  });

  const indexWarnings = getRedundantIndexes(target, source).map(({ table, index, coveringIndex }) => {
    return `Index ${table}.${index} is covered by ${table}.${coveringIndex}, which starts with its columns: keeping both costs every write.`;
  });

  const renameWarnings = getDetectedRenames(target, source).map(({ table, from, to }) => {
    const name = table ? `Column ${table}.${from}` : `Table ${from}`;

    return (
      `${name} is renamed to ${to} because the names look alike: declare it in renamedFrom, ` +
      `or add ${to} and remove ${from} in separate deploys if it is not a rename.`
    );
  });

  return [...foreignKeyWarnings, ...indexWarnings, ...renameWarnings];
};

export type DetectedRename = {
  table?: string;
  from: string;
  to: string;
};

/**
 * Tables and columns the migration renames because their names look alike, without a `renamedFrom`
 * declaring it. A table or column that is removed while another one with a similar name is added
 * looks like a rename, which moves its data to the new one.
 */
export const getDetectedRenames = (target: PgTableRepository, source: PgTableRepository) => {
  const changes = getTableRepositoryChanges(target, source);
  const renames: DetectedRename[] = [];

  for (const from in changes.rename) {
    const to = changes.rename[from];

    if (target[to].renamedFrom?.table !== from) {
      renames.push({ from, to });
    }
  }

  for (const table in changes.nested) {
    const columnRenames = changes.nested[table].nested?.schema?.nested?.properties?.rename;

    for (const from in columnRenames) {
      const to = columnRenames[from];

      if (target[table].renamedFrom?.columns?.[to] !== from) {
        renames.push({ table, from, to });
      }
    }
  }

  return renames;
};

export type UnindexedForeignKey = {
  table: string;
  column: string;
  sourceTable: string;
};

/**
 * Foreign keys the migration leaves with no index led by their column, either new or losing the index
 * they had. Deleting or updating a referenced record searches the referencing table for its key, so
 * without that index each one scans the table. Keys that already had no index aren't listed again.
 */
export const getUnindexedForeignKeys = (target: PgTableRepository, source: PgTableRepository) => {
  const foreignKeys: UnindexedForeignKey[] = [];

  for (const table in target) {
    const { relations, indexes } = target[table];

    for (const targetAlias in relations) {
      const relation = relations[targetAlias];

      if (!RelationQuery.hasForeignKey(relation) || hasKeyIndex(indexes, relation)) {
        continue;
      }

      const sourceRelation = source[table]?.relations[targetAlias];

      if (sourceRelation && isUnindexedKey(sourceRelation, source[table].indexes, relation.targetColumn)) {
        continue;
      }

      foreignKeys.push({
        table,
        column: relation.targetColumn,
        sourceTable: relation.sourceTable
      });
    }
  }

  return foreignKeys;
};

const isUnindexedKey = (relation: PgRelationMetadata, indexes: PgIndexRepository, column: string) => {
  return RelationQuery.hasForeignKey(relation) && relation.targetColumn === column && !hasKeyIndex(indexes, relation);
};

// The key lookup filters the key columns (the scope and the column), so an index serves it when it is led by
// the column or by all of them. A partial index serves it only when it leaves out just the rows without a key.
const hasKeyIndex = (indexes: PgIndexRepository, relation: PgRelationMetadata) => {
  const { targetColumn, scope = [] } = relation;

  const keyColumns = [...scope, targetColumn];

  return Object.values(indexes).some(({ columns, options }) => {
    const leadingColumns = columns.slice(0, keyColumns.length);
    const isLeading = columns[0] === targetColumn || keyColumns.every((column) => leadingColumns.includes(column));

    return isLeading && (!options?.where || isNotNullFilter(options.where, targetColumn));
  });
};

const isNotNullFilter = (filters: TableIndexFilters, column: string) => {
  const filterKeys = Object.keys(filters);
  const filter = filters[column];

  return (
    filterKeys.length === 1 &&
    filterKeys[0] === column &&
    isAnyObject(filter) &&
    (deepEqual(filter, { not: null }) || deepEqual(filter, { isNull: false }))
  );
};

export type RedundantIndex = {
  table: string;
  index: string;
  coveringIndex: string;
};

/**
 * Secondary indexes the migration leaves covered by another index of the table, whose columns start
 * with theirs: the other index serves the same queries, and keeping both costs every write. Only a
 * pair where one of the indexes is new or changed is listed, so a schema isn't reported on every
 * deploy.
 */
export const getRedundantIndexes = (target: PgTableRepository, source: PgTableRepository) => {
  const redundantIndexes: RedundantIndex[] = [];

  for (const table in target) {
    const { indexes } = target[table];
    const sourceIndexes = source[table]?.indexes ?? {};

    const isChanged = (indexKey: string) => {
      const sourceIndex = sourceIndexes[indexKey];

      return !sourceIndex || !deepEqual(indexes[indexKey], sourceIndex);
    };

    for (const indexKey in indexes) {
      const index = indexes[indexKey];

      if (index.type !== Index.Secondary || index.options) {
        continue;
      }

      const coveringKey = Object.keys(indexes).find((otherKey) => {
        const { columns, options } = indexes[otherKey];

        const isCovering =
          otherKey !== indexKey &&
          columns.length >= index.columns.length &&
          index.columns.every((column, position) => columns[position] === column) &&
          !options?.where &&
          (options?.method ?? 'btree') === 'btree';

        return isCovering && (isChanged(indexKey) || isChanged(otherKey));
      });

      if (coveringKey) {
        redundantIndexes.push({
          table,
          index: indexKey,
          coveringIndex: coveringKey
        });
      }
    }
  }

  return redundantIndexes;
};
