import type { StepContext, StepHandler } from '@ez4/state';
import type { MigrationState, MigrationResult } from './types';

import { CorruptedResourceError, OperationLogger, ReplaceResourceError } from '@ez4/aws-common';
import { getCreateQueries, getMigrationStatements, getMigrationWarnings, getUpdateStepQueries } from '@ez4/pgmigration';
import { Logger } from '@ez4/logger';
import { getTableRepositoryChanges } from '@ez4/pgmigration/library';
import { deepCompare, isEmptyObject } from '@ez4/utils';

import { getClusterResult } from '../cluster/utils';
import { createDatabase, deleteDatabase, modifyDatabase } from './client';
import { MigrationServiceName } from './types';

export const getMigrationHandler = (): StepHandler<MigrationState> => ({
  equals: equalsResource,
  create: createResource,
  replace: replaceResource,
  preview: previewResource,
  update: updateResource,
  delete: deleteResource
});

const equalsResource = (candidate: MigrationState, current: MigrationState) => {
  return !!candidate.result && candidate.result.clusterArn === current.result?.clusterArn;
};

const previewResource = (candidate: MigrationState, current: MigrationState) => {
  const target = { ...candidate.parameters, dependencies: candidate.dependencies };
  const source = { ...current.parameters, dependencies: current.dependencies };

  const sourceRepository = (current.partial ? current.result?.oldRepository : undefined) ?? source.repository;
  const targetRepository = target.repository;

  for (const warning of getMigrationWarnings(targetRepository, sourceRepository)) {
    Logger.warn(warning);
  }

  const resourceChanges = deepCompare(
    {
      ...target,
      rollout: true
    },
    {
      ...source,
      rollout: !current.partial
    },
    {
      exclude: {
        repository: true
      }
    }
  );

  // A migration run outside of the deploy changes nothing here, whatever the repository says.
  if (target.disabled) {
    return {
      ...resourceChanges,
      name: target.database
    };
  }

  const databaseChanges = getTableRepositoryChanges(targetRepository, sourceRepository);
  const statements = getMigrationStatements(targetRepository, sourceRepository);

  return {
    ...resourceChanges,
    counts: resourceChanges.counts + (databaseChanges.counts && 1),
    name: target.database,
    nested: {
      ...resourceChanges.nested,
      repository: databaseChanges,
      ...(!isEmptyObject(statements) && {
        statements: {
          counts: Object.keys(statements).length,
          create: statements
        }
      })
    }
  };
};

const replaceResource = async (candidate: MigrationState, current: MigrationState, context: StepContext) => {
  if (current.result) {
    throw new ReplaceResourceError(MigrationServiceName, candidate.entryId, current.entryId);
  }

  return createResource(candidate, context);
};

const createResource = (candidate: MigrationState, context: StepContext): Promise<MigrationResult> => {
  const { database, repository, disabled } = candidate.parameters;

  return OperationLogger.logExecution(MigrationServiceName, database, 'creation', async (logger) => {
    const { clusterArn, secretArn } = getClusterResult(MigrationServiceName, 'migration', context);

    await createDatabase(logger, {
      database,
      clusterArn,
      secretArn
    });

    if (!disabled) {
      await modifyDatabase(logger, {
        database,
        clusterArn,
        secretArn,
        queries: getCreateQueries(repository)
      });
    }

    return {
      clusterArn,
      secretArn
    };
  });
};

const updateResource = async (candidate: MigrationState, current: MigrationState, context: StepContext) => {
  const { result, parameters } = candidate;
  const { database, repository: targetRepository } = parameters;

  return OperationLogger.logExecution(MigrationServiceName, database, 'updates', async (logger) => {
    if (!result) {
      throw new CorruptedResourceError(MigrationServiceName, database);
    }

    const sourceRepository = (current.partial ? current.result?.oldRepository : undefined) ?? current.parameters.repository;
    const databaseChanges = getTableRepositoryChanges(targetRepository, sourceRepository);

    const connectionData = {
      clusterArn: result.clusterArn,
      secretArn: result.secretArn
    };

    const newResult: MigrationResult = {
      ...connectionData
    };

    if (databaseChanges.counts && !parameters.disabled) {
      newResult.oldRepository = sourceRepository;

      const steps = getUpdateStepQueries(targetRepository, sourceRepository);

      await modifyDatabase(logger, {
        ...connectionData,
        queries: steps.prepare,
        database
      });

      context.postAction(() =>
        OperationLogger.logExecution(MigrationServiceName, database, 'rollout', async (logger) => {
          await modifyDatabase(logger, {
            ...connectionData,
            queries: steps.rollout,
            database
          });

          // Registered from the rollout, the cleanup runs after the code switch of the functions using the database. While
          // an entry depending on the migration failed, old code may still need what it drops: the entry stays partial,
          // keeping the old repository, and the next deploy runs it again.
          context.postAction(
            () =>
              OperationLogger.logExecution(MigrationServiceName, database, 'cleanup', async (logger) => {
                await modifyDatabase(logger, {
                  ...connectionData,
                  queries: steps.cleanup,
                  database
                });

                delete newResult.oldRepository;
              }),
            { requireDependents: true }
          );
        })
      );
    }

    return newResult;
  });
};

const deleteResource = async (current: MigrationState, context: StepContext) => {
  const { result, parameters } = current;
  const { database, allowDeletion, disabled } = parameters;

  if (result) {
    return OperationLogger.logExecution(MigrationServiceName, database, 'deletion', async (logger) => {
      // The database holds tables the deploy doesn't own, so not even a forced deploy drops it.
      if (disabled) {
        context.addWarning(`Database '${database}' is migrated outside of the deploy and isn't deleted.`);
        return;
      }

      if (!allowDeletion && !context.force) {
        context.addWarning(`Deletion of database '${database}' is denied.`);
        return;
      }

      const { clusterArn, secretArn } = result;

      await deleteDatabase(logger, {
        clusterArn,
        secretArn,
        database
      });
    });
  }
};
