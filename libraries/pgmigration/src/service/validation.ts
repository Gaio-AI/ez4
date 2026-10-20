import type { PgRelationMetadata, PgTableRepository } from '@ez4/pgclient/library';
import type { AnySchema, ObjectSchema } from '@ez4/schema';

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

        if (relation.scope) {
          throw new MigrationRelationError(relationName, 'has a scope but no foreign key');
        }

        continue;
      }

      if (relation.scope) {
        validateScope(target, relationName, relation, schema);
      }

      if (relation.foreignKey && relation.sourceIndex !== Index.Primary && relation.sourceIndex !== Index.Unique) {
        throw new MigrationRelationError(relationName, `references ${relation.sourceColumn}, which isn't a primary or unique key`);
      }

      if (RelationQuery.getDeleteAction(relation, schema) === 'set null' && targetSchema && !isOptionalColumn(targetSchema)) {
        throw new MigrationRelationError(relationName, `sets ${relation.targetColumn} to null, which doesn't take null`);
      }

      const targetPrimary = relation.targetIndex === Index.Primary;
      const sourcePrimary = relation.sourceIndex === Index.Primary;

      if (targetSchema && sourceSchema && getKeyType(targetSchema, targetPrimary) !== getKeyType(sourceSchema, sourcePrimary)) {
        throw new MigrationRelationError(relationName, `holds a key of another type than ${relation.sourceColumn}`);
      }
    }
  }
};

// A scoped key references the scope columns and the related column together, so Postgres needs a
// unique key on exactly those columns of the related table, and each scope column of the same type.
const validateScope = (target: PgTableRepository, relationName: string, relation: PgRelationMetadata, schema: ObjectSchema) => {
  const { sourceTable, sourceColumn, targetColumn, scope = [] } = relation;

  const keyColumns = [...scope, sourceColumn];

  if (hasRepeatedColumn(keyColumns) || hasRepeatedColumn([...scope, targetColumn])) {
    throw new MigrationRelationError(relationName, 'has a scope that repeats a column of its key');
  }

  const sourceTableMetadata = target[sourceTable];

  const hasKey = Object.values(sourceTableMetadata?.indexes ?? {}).some(({ type, columns, options }) => {
    return (
      (type === Index.Primary || type === Index.Unique) &&
      !options?.where &&
      columns.length === keyColumns.length &&
      keyColumns.every((column) => columns.includes(column))
    );
  });

  if (!hasKey) {
    throw new MigrationRelationError(
      relationName,
      `references ${sourceColumn} within ${scope.join(', ')}, which needs a primary or unique key on ${keyColumns.join(', ')} in ${sourceTable}`
    );
  }

  for (const scopeColumn of scope) {
    const targetSchema = schema.properties[scopeColumn];
    const sourceSchema = sourceTableMetadata?.schema.properties[scopeColumn];

    // Postgres only checks a key with many columns when none of them is null.
    if (targetSchema && isOptionalColumn(targetSchema)) {
      throw new MigrationRelationError(
        relationName,
        `is scoped by ${scopeColumn}, which takes null: the key isn't checked on records without it`
      );
    }

    if (targetSchema && sourceSchema && getKeyType(targetSchema, false) !== getKeyType(sourceSchema, false)) {
      throw new MigrationRelationError(relationName, `is scoped by ${scopeColumn}, which has another type in ${sourceTable}`);
    }
  }
};

const hasRepeatedColumn = (columns: string[]) => {
  return new Set(columns).size < columns.length;
};

// Types a foreign key can compare: a serial key is a bigint, and every string is compared as text.
const getKeyType = (schema: AnySchema, primary: boolean) => {
  const type = getColumnType(schema, primary);

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
