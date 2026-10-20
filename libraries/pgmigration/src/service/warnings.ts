import type { PgIndexRepository, PgRelationMetadata, PgTableRepository } from '@ez4/pgclient/library';

import { RelationQuery } from '../queries/relations';

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

      if (!RelationQuery.hasForeignKey(relation) || hasLeadingIndex(indexes, relation.targetColumn)) {
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
  return RelationQuery.hasForeignKey(relation) && relation.targetColumn === column && !hasLeadingIndex(indexes, column);
};

const hasLeadingIndex = (indexes: PgIndexRepository, column: string) => {
  return Object.values(indexes).some(({ columns }) => columns[0] === column);
};
