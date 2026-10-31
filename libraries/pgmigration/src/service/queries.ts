import type { PgTableRepository } from '@ez4/pgclient/library';
import type { OptionalObject } from '@ez4/utils';
import type { PgMigrationQueries, PgMigrationSteps } from '../types/query';

import { SqlBuilder } from '@ez4/pgsql';

import { getTableRepositoryChanges } from '../utils/repository';
import { ConstraintQuery } from '../queries/constraints';
import { RelationQuery } from '../queries/relations';
import { IndexQueries } from '../queries/indexes';
import { TimestampQuery } from '../queries/timestamps';
import { ColumnQuery } from '../queries/columns';
import { TableQuery } from '../queries/tables';

export const getCreateQueries = (target: PgTableRepository) => {
  const builder = new SqlBuilder();

  const queries: PgMigrationQueries = {
    tables: [],
    constraints: [],
    validations: [],
    relations: [],
    indexes: []
  };

  for (const table in target) {
    const { name, schema, indexes, relations, timestamps } = target[table];

    queries.tables.push(TableQuery.prepareCreate(builder, name, schema, indexes, timestamps));

    combineQueries(queries, RelationQuery.prepareCreate(builder, name, schema, relations));
    combineQueries(queries, ConstraintQuery.prepareCreate(builder, name, schema.properties));
    combineQueries(queries, IndexQueries.prepareCreate(builder, name, schema, indexes));
  }

  combineQueries(queries, { triggers: TimestampQuery.prepareCreate(builder, target) });

  return queries;
};

export const getUpdateStepQueries = (target: PgTableRepository, source: PgTableRepository) => {
  const changes = getTableRepositoryChanges(target, source);
  const builder = new SqlBuilder();
  const renamed = new Set();

  const steps: PgMigrationSteps = {
    prepare: getStepQueries(),
    rollout: getStepQueries(),
    cleanup: getStepQueries()
  };

  if (changes.create) {
    combineQueries(steps.prepare, getCreateQueries(changes.create));
  }

  // Compared here, since a table whose only change is its timestamps has no nested changes.
  const timestampSteps = TimestampQuery.prepareUpdate(
    builder,
    target,
    changes.source,
    changes.remove ?? {},
    TimestampQuery.getFunctionColumns(changes.create ?? {})
  );

  combineSteps(steps, {
    prepare: { triggers: timestampSteps.prepare },
    cleanup: { triggers: timestampSteps.cleanup }
  });

  if (changes.rename) {
    for (const fromTable in changes.rename) {
      const toTable = changes.rename[fromTable];

      const sourceIndexes = source[fromTable].indexes;
      const sourceRelations = source[fromTable].relations;
      const sourceSchema = source[fromTable].schema;

      steps.rollout.tables.push(TableQuery.prepareRename(builder, fromTable, toTable));
      steps.rollout.constraints.push(...ConstraintQuery.prepareRenameTable(builder, fromTable, toTable, sourceSchema.properties));
      steps.rollout.relations.push(...RelationQuery.prepareRename(builder, fromTable, toTable, sourceRelations));

      combineQueries(steps.rollout, IndexQueries.prepareRenameTable(builder, fromTable, toTable, sourceIndexes));

      renamed.add(toTable);
    }
  }

  if (changes.nested) {
    for (const table in changes.nested) {
      const { nested: tableChanges } = changes.nested[table];

      if (!tableChanges) {
        continue;
      }

      const { schema, relations: relationChanges, indexes: indexChanges } = tableChanges;

      const targetColumns = schema?.nested?.properties;

      const sourceIndexes = changes.source[table].indexes;
      const targetIndexes = target[table].indexes;

      const sourceSchema = changes.source[table].schema;
      const targetSchema = target[table].schema;

      const sourceTable = changes.source[table].name;

      const sourceTimestamps = changes.source[table].timestamps;
      const targetTimestamps = target[table].timestamps;

      if (targetColumns?.rename) {
        TimestampQuery.validateRenames(table, sourceTimestamps, targetTimestamps, targetColumns.rename);
      }

      if (targetColumns?.create) {
        steps.prepare.tables.push(ColumnQuery.prepareCreate(builder, sourceTable, targetIndexes, targetColumns.create, targetTimestamps));
        combineQueries(steps.prepare, ConstraintQuery.prepareCreate(builder, sourceTable, targetColumns.create));

        if (renamed.has(table)) {
          steps.rollout.constraints.push(...ConstraintQuery.prepareRenameTable(builder, sourceTable, table, targetColumns.create));
        }
      }

      // A declared rename can come with changes to the column, made under its new name.
      if (targetColumns?.rename) {
        steps.rollout.tables.push(...ColumnQuery.prepareRename(builder, table, targetColumns.rename));
        steps.rollout.constraints.push(...ConstraintQuery.prepareRenameColumns(builder, table, targetSchema, targetColumns.rename));
      }

      if (targetColumns?.nested) {
        steps.rollout.tables.push(
          ...ColumnQuery.prepareUpdate(builder, table, targetSchema, targetIndexes, targetColumns.nested, targetTimestamps)
        );
        combineSteps(steps, ConstraintQuery.prepareUpdate(builder, table, targetSchema, sourceSchema, targetColumns.nested));
      }

      if (targetColumns?.remove) {
        steps.cleanup.tables.push(ColumnQuery.prepareDelete(builder, table, targetColumns.remove));
        steps.cleanup.constraints.push(...ConstraintQuery.prepareDelete(builder, table, targetColumns.remove));
      }

      if (indexChanges) {
        combineSteps(
          steps,
          IndexQueries.prepareChanges(builder, table, targetSchema, sourceIndexes, targetIndexes, indexChanges, targetColumns?.rename ?? {})
        );
      }

      if (relationChanges?.create) {
        combineQueries(steps.rollout, RelationQuery.prepareCreate(builder, table, targetSchema, relationChanges.create));
      }

      combineSteps(steps, RelationQuery.prepareUpdate(builder, table, changes.source[table], target[table]));

      if (relationChanges?.remove) {
        steps.cleanup.relations.push(...RelationQuery.prepareDelete(builder, table, relationChanges.remove));
      }
    }
  }

  if (changes.remove) {
    combineQueries(steps.cleanup, getDeleteQueries(changes.remove));
  }

  return steps;
};

export const getDeleteQueries = (target: PgTableRepository) => {
  const builder = new SqlBuilder();

  const queries: PgMigrationQueries = {
    tables: [],
    constraints: [],
    validations: [],
    relations: [],
    indexes: []
  };

  for (const table in target) {
    const { name } = target[table];

    queries.tables.push(TableQuery.prepareDelete(builder, name));
  }

  return queries;
};

const combineSteps = (target: PgMigrationSteps, source: OptionalObject<PgMigrationSteps>) => {
  if (source.prepare) {
    combineQueries(target.prepare, source.prepare);
  }

  if (source.rollout) {
    combineQueries(target.rollout, source.rollout);
  }

  if (source.cleanup) {
    combineQueries(target.cleanup, source.cleanup);
  }
};

const combineQueries = (target: PgMigrationQueries, source: OptionalObject<PgMigrationQueries>) => {
  if (source.tables) {
    target.tables.push(...source.tables);
  }

  if (source.triggers?.length) {
    target.triggers = [...(target.triggers ?? []), ...source.triggers];
  }

  if (source.constraints) {
    target.constraints.push(...source.constraints);
  }

  if (source.validations) {
    target.validations.push(...source.validations);
  }

  if (source.relations) {
    target.relations.push(...source.relations);
  }

  if (source.indexes) {
    target.indexes.push(...source.indexes);
  }
};

const getStepQueries = () => {
  return {
    tables: [],
    constraints: [],
    validations: [],
    relations: [],
    indexes: []
  };
};
