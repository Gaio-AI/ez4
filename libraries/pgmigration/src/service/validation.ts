import type { PgRelationMetadata, PgTableRepository } from '@ez4/pgclient/library';
import type { AnySchema } from '@ez4/schema';

import { Index } from '@ez4/database';
import { isAnyObject } from '@ez4/utils';

import { MigrationNameCollisionError } from '../errors/naming';
import { MigrationRelationError } from '../errors/relation';
import { MigrationIndexError } from '../errors/index';
import { ConstraintQuery } from '../queries/constraints';
import { RelationQuery } from '../queries/relations';
import { IndexQueries } from '../queries/indexes';
import { getColumnType, isOptionalColumn } from '../utils/columns';
import { getStoredName } from '../utils/naming';

/**
 * Throws on what the repository declares but Postgres can't build, or would build different from the
 * declaration, before anything is deployed.
 */
export const validateRepository = (target: PgTableRepository) => {
  validateIndexes(target);
  validateRelations(target);
  validateNames(target);
};

const INDEX_FILTER_OPERATORS = ['equal', 'not', 'gt', 'gte', 'lt', 'lte', 'isIn', 'isNull'];

const validateIndexes = (target: PgTableRepository) => {
  for (const table in target) {
    const { indexes } = target[table];

    for (const indexKey in indexes) {
      const { type, options } = indexes[indexKey];

      if (!options) {
        continue;
      }

      const indexName = `${table}.${indexKey}`;
      const method = options.method ?? 'btree';

      if (type === Index.Unique && method !== 'btree') {
        throw new MigrationIndexError(indexName, `is unique, which only a btree index can be`);
      }

      if (options.nullsNotDistinct && type !== Index.Unique) {
        throw new MigrationIndexError(indexName, `has nulls not distinct, which only a unique index takes`);
      }

      if (options.order && method !== 'btree') {
        throw new MigrationIndexError(indexName, `has an order, which only a btree index keeps`);
      }

      if (options.include && method !== 'btree' && method !== 'gist') {
        throw new MigrationIndexError(indexName, `includes columns, which only a btree or gist index stores`);
      }

      if (options.where && !isIndexFilters(options.where)) {
        throw new MigrationIndexError(indexName, `has a where with an operator other than ${INDEX_FILTER_OPERATORS.join(', ')}`);
      }
    }
  }
};

// Each column is compared to a literal (or null), or takes operators that compare it to literals.
const isIndexFilters = (filters: Record<string, unknown>) => {
  return Object.values(filters).every((value) => {
    if (!isAnyObject(value)) {
      return true;
    }

    return Object.keys(value).every((operator) => INDEX_FILTER_OPERATORS.includes(operator));
  });
};

const validateRelations = (target: PgTableRepository) => {
  for (const table in target) {
    const { schema, relations } = target[table];

    for (const targetAlias in relations) {
      const relation = relations[targetAlias];
      const relationName = `${table}.${targetAlias}`;

      const targetSchema = schema.properties[relation.targetColumn];
      const sourceSchema = target[relation.sourceTable]?.schema.properties[relation.sourceColumn];

      if (!RelationQuery.hasForeignKey(relation)) {
        if (relation.onDelete) {
          throw new MigrationRelationError(relationName, 'has a delete action but no foreign key');
        }

        continue;
      }

      if (relation.foreignKey && relation.sourceIndex !== Index.Primary && relation.sourceIndex !== Index.Unique) {
        throw new MigrationRelationError(relationName, `references ${relation.sourceColumn}, which isn't a primary or unique key`);
      }

      if (RelationQuery.getDeleteAction(relation, schema) === 'set null' && targetSchema && !isOptionalColumn(targetSchema)) {
        throw new MigrationRelationError(relationName, `sets ${relation.targetColumn} to null, which doesn't take null`);
      }

      if (targetSchema && sourceSchema && getKeyType(targetSchema, relation) !== getKeyType(sourceSchema, relation, true)) {
        throw new MigrationRelationError(relationName, `holds a key of another type than ${relation.sourceColumn}`);
      }
    }
  }
};

// Types a foreign key can compare: a serial key is a bigint, and every string is compared as text.
const getKeyType = (schema: AnySchema, relation: PgRelationMetadata, source?: boolean) => {
  const index = source ? relation.sourceIndex : relation.targetIndex;
  const type = getColumnType(schema, index === Index.Primary);

  if (type === 'bigserial') {
    return 'bigint';
  }

  if (type.startsWith('varchar(')) {
    return 'text';
  }

  return type;
};

/**
 * Two object names that are the same once Postgres truncates them: the second object is never created
 * (its existence check finds the first one) and dropping it would drop the first. Indexes share one
 * namespace and constraints another, since the migration looks constraints up by name.
 */
const validateNames = (target: PgTableRepository) => {
  const indexNames: string[] = [];
  const constraintNames: string[] = [];

  for (const table in target) {
    const { name, schema, indexes, relations } = target[table];

    const tableIndexNames = IndexQueries.getNames(name, indexes);

    indexNames.push(...tableIndexNames.indexes);

    constraintNames.push(
      ...tableIndexNames.constraints,
      ...RelationQuery.getNames(name, relations),
      ...ConstraintQuery.getNames(name, schema.properties)
    );
  }

  const collisions = [...getCollisions(indexNames), ...getCollisions(constraintNames)];

  if (collisions.length) {
    throw new MigrationNameCollisionError(collisions);
  }
};

const getCollisions = (names: string[]) => {
  const namesByStoredName = new Map<string, Set<string>>();

  for (const name of names) {
    const storedName = getStoredName(name);

    namesByStoredName.set(storedName, (namesByStoredName.get(storedName) ?? new Set()).add(name));
  }

  return [...namesByStoredName.values()].filter((group) => group.size > 1).flatMap((group) => [...group]);
};
