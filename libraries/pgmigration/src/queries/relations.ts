import type { PgRelationMetadata, PgRelationRepository, PgTableMetadata } from '@ez4/pgclient/library';
import type { RelationDeleteAction } from '@ez4/database/library';
import type { ObjectSchema } from '@ez4/schema';
import type { SqlBuilder } from '@ez4/pgsql';
import type { PgMigrationQueries } from '../types/query';

import { getTableName } from '@ez4/pgclient/utils';
import { deepEqual } from '@ez4/utils';
import { Index } from '@ez4/database';

import { isOptionalColumn } from '../utils/columns';
import { getRelationName, getTemporaryName } from '../utils/naming';

import {
  getCheckConstraintExistsQuery,
  getCheckConstraintInvalidQuery,
  getCheckRunningValidationQuery,
  getCheckConstraintValidQuery
} from '../utils/checks';

type RelationQueries = Pick<PgMigrationQueries, 'relations' | 'validations'>;

type ForeignKey = {
  sourceTable: string;
  sourceColumn: string;
  targetColumn: string;
  onDelete: RelationDeleteAction;
  scope: string[];
};

export namespace RelationQuery {
  export const prepareCreate = (builder: SqlBuilder, table: string, schema: ObjectSchema, relations: PgRelationRepository) => {
    const statements: RelationQueries = {
      validations: [],
      relations: []
    };

    for (const targetAlias in relations) {
      const foreignKey = getForeignKey(relations[targetAlias], schema);

      if (!foreignKey) {
        continue;
      }

      const relationName = getRelationName(table, targetAlias);

      statements.relations.push(
        {
          check: getCheckConstraintExistsQuery(builder, relationName),
          query: getCreateQuery(builder, table, relationName, foreignKey).build()
        },
        {
          check: getCheckConstraintValidQuery(builder, relationName),
          query: getValidateQuery(builder, table, relationName).build()
        }
      );

      statements.validations.push({
        check: getCheckConstraintInvalidQuery(builder, relationName),
        retry: getCheckRunningValidationQuery(builder, relationName),
        name: relationName
      });
    }

    return statements;
  };

  /**
   * The foreign keys of a table that already exists, compared as the constraints they make: whether the
   * relation has one, what it references and its delete action. A change that keeps the key (such as
   * dropping the index that supports its column) leaves the constraint in place, and a key that changes
   * for more than one reason is replaced once.
   */
  export const prepareUpdate = (builder: SqlBuilder, table: string, source: PgTableMetadata, target: PgTableMetadata) => {
    const steps = {
      rollout: { validations: [], relations: [] } as RelationQueries,
      cleanup: { validations: [], relations: [] } as RelationQueries
    };

    for (const targetAlias in target.relations) {
      const sourceRelation = source.relations[targetAlias];

      if (!sourceRelation) {
        continue;
      }

      const sourceKey = getForeignKey(sourceRelation, source.schema);
      const targetKey = getForeignKey(target.relations[targetAlias], target.schema);

      const newName = getRelationName(table, targetAlias);

      if (!targetKey) {
        if (sourceKey) {
          steps.cleanup.relations.push({
            query: getDeleteQuery(builder, table, newName).build()
          });
        }

        continue;
      }

      if (sourceKey && deepEqual(sourceKey, targetKey)) {
        continue;
      }

      const tmpName = getTemporaryName(newName);

      steps.rollout.relations.push(
        {
          check: getCheckConstraintExistsQuery(builder, tmpName),
          query: getCreateQuery(builder, table, tmpName, targetKey).build()
        },
        {
          check: getCheckConstraintValidQuery(builder, tmpName),
          query: getValidateQuery(builder, table, tmpName).build()
        }
      );

      steps.rollout.validations.push({
        check: getCheckConstraintInvalidQuery(builder, tmpName),
        retry: getCheckRunningValidationQuery(builder, tmpName),
        name: newName
      });

      steps.cleanup.relations.push(
        {
          query: getDeleteQuery(builder, table, newName).build()
        },
        {
          query: builder.table(table).alter().existing().constraint(tmpName).rename(newName).build()
        }
      );
    }

    return steps;
  };

  export const prepareRename = (builder: SqlBuilder, fromTable: string, toTable: string, relations: PgRelationRepository) => {
    const statements = [];

    for (const targetAlias in relations) {
      if (!hasForeignKey(relations[targetAlias])) {
        continue;
      }

      const oldName = getRelationName(fromTable, targetAlias);
      const newName = getRelationName(toTable, targetAlias);

      const query = builder.table(toTable).alter().existing().constraint(oldName).rename(newName);

      statements.push({
        check: getCheckConstraintExistsQuery(builder, newName),
        query: query.build()
      });
    }

    return statements;
  };

  export const prepareDelete = (builder: SqlBuilder, table: string, relations: PgRelationRepository) => {
    const statements = [];

    for (const targetAlias in relations) {
      if (!hasForeignKey(relations[targetAlias])) {
        continue;
      }

      const relationName = getRelationName(table, targetAlias);

      statements.push({
        query: getDeleteQuery(builder, table, relationName).build()
      });
    }

    return statements;
  };

  export const getNames = (table: string, relations: PgRelationRepository) => {
    return Object.keys(relations)
      .filter((targetAlias) => hasForeignKey(relations[targetAlias]))
      .map((targetAlias) => getRelationName(table, targetAlias));
  };

  /**
   * Whether the relation is held by a foreign key: unless it says so, when the record holds the key of
   * a primary or unique column of another record.
   */
  export const hasForeignKey = (relation: PgRelationMetadata) => {
    if (relation.foreignKey !== undefined) {
      return relation.foreignKey;
    }

    const { sourceIndex, targetIndex } = relation;

    return !!sourceIndex && sourceIndex !== Index.Secondary && targetIndex !== Index.Primary;
  };

  /**
   * What deleting the referenced record does to the record holding the key: unless the relation says,
   * the key is cleared when its column takes null, and the record is deleted otherwise.
   */
  export const getDeleteAction = (relation: PgRelationMetadata, schema: ObjectSchema): RelationDeleteAction => {
    if (relation.onDelete) {
      return relation.onDelete;
    }

    const columnSchema = schema.properties[relation.targetColumn];

    return columnSchema && isOptionalColumn(columnSchema) ? 'set null' : 'cascade';
  };

  const getForeignKey = (relation: PgRelationMetadata, schema: ObjectSchema): ForeignKey | undefined => {
    if (!hasForeignKey(relation)) {
      return undefined;
    }

    const { sourceTable, sourceColumn, targetColumn, scope = [] } = relation;

    return {
      sourceTable,
      sourceColumn,
      targetColumn,
      onDelete: getDeleteAction(relation, schema),
      scope
    };
  };

  const getDeleteQuery = (builder: SqlBuilder, table: string, name: string) => {
    return builder.table(table).alter().existing().constraint(name).drop().existing();
  };

  const getValidateQuery = (builder: SqlBuilder, table: string, name: string) => {
    return builder.table(table).alter().existing().constraint(name).validate();
  };

  // A scoped key references the record within the scope it shares with it (`account_id`, for example), so it
  // can't point to a record of another scope. Clearing it on delete clears its own column only, not the scope.
  const getCreateQuery = (builder: SqlBuilder, table: string, name: string, foreignKey: ForeignKey) => {
    const { sourceTable, sourceColumn, targetColumn, onDelete, scope } = foreignKey;

    const query = builder.table(table).alter().existing().constraint(name);
    const constraint = query.foreign([...scope, targetColumn], getTableName(sourceTable), [...scope, sourceColumn]);

    const deleteAction = constraint.delete();

    switch (onDelete) {
      case 'cascade':
        deleteAction.cascade();
        break;

      case 'set null':
        deleteAction.null(scope.length ? [targetColumn] : undefined);
        break;

      case 'restrict':
        deleteAction.restrict();
        break;

      case 'no action':
        deleteAction.noAction();
        break;
    }

    constraint.update().cascade();
    constraint.validate(false);

    return query;
  };
}
