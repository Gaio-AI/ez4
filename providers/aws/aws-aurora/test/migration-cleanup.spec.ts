import type { EntryState, EntryStates, StepHandler, StepHandlers } from '@ez4/state';
import type { PgTableRepository } from '@ez4/pgclient/library';
import type { ExecuteStatementCommandOutput } from '@aws-sdk/client-rds-data';
import type { TestContext } from 'node:test';
import type { IntegrityState } from '../src/integrity/types';
import type { MigrationState } from '../src/migration/types';
import type { ClusterState } from '../src/cluster/types';

import { describe, it } from 'node:test';
import { deepEqual, ok } from 'node:assert/strict';

import { RDSDataClient, ExecuteStatementCommand } from '@aws-sdk/client-rds-data';
import { applySteps, planSteps } from '@ez4/state';
import { deepCompare, hashObject } from '@ez4/utils';
import { SchemaType } from '@ez4/schema';
import { Index } from '@ez4/database';

import { getIntegrityHandler } from '../src/integrity/handler';
import { getMigrationHandler } from '../src/migration/handler';
import { IntegrityServiceType } from '../src/integrity/types';
import { MigrationServiceType } from '../src/migration/types';
import { ClusterServiceType } from '../src/cluster/types';

const FunctionServiceType = 'test:function';

type FunctionState = EntryState & {
  type: typeof FunctionServiceType;
  parameters: {
    version: string;
    failAlias?: boolean;
  };
  result?: {
    version: string;
  };
};

type TestState = ClusterState | MigrationState | IntegrityState | FunctionState;

const clusterArn = 'arn:aws:rds:us-east-1:000000000000:cluster:test';
const secretArn = 'arn:aws:secretsmanager:us-east-1:000000000000:secret:test';

const getRepository = (columns: string[]): PgTableRepository => ({
  items: {
    name: 'items',
    relations: {},
    indexes: {
      id: { name: 'id', columns: ['id'], type: Index.Primary },
      status: { name: 'status', columns: ['status'], type: Index.Secondary }
    },
    schema: {
      type: SchemaType.Object,
      properties: Object.fromEntries(columns.map((column) => [column, { type: SchemaType.String }]))
    }
  }
});

const oldRepository = getRepository(['id', 'status', 'legacy']);
const newRepository = getRepository(['id', 'status']);

const validateIndexQuery = `SELECT 1 FROM "pg_index" WHERE "indexrelid" = 'items_status_sk'::regclass AND ("indisvalid" = false OR "indisready" = false)`;
const validateRetryQuery = `SELECT 1 FROM "pg_stat_activity" WHERE "state" = 'active' AND "pid" != pg_backend_pid() AND "query" ILIKE '%' || '"items_status_sk"' || '%' LIMIT 1`;
const dropColumnQuery = `ALTER TABLE IF EXISTS "items" DROP COLUMN IF EXISTS "legacy"`;

const buildState = (repository: PgTableRepository, version: string, failAlias?: boolean): EntryStates<TestState> => ({
  cluster: {
    type: ClusterServiceType,
    entryId: 'cluster',
    dependencies: [],
    parameters: {
      clusterName: 'test'
    },
    result: {
      writerEndpoint: 'writer',
      readerEndpoint: 'reader',
      clusterArn,
      secretArn
    }
  },
  migration: {
    type: MigrationServiceType,
    entryId: 'migration',
    dependencies: ['cluster'],
    parameters: {
      database: 'test',
      repository
    },
    result: {
      clusterArn,
      secretArn
    }
  },
  integrity: {
    type: IntegrityServiceType,
    entryId: 'integrity',
    dependencies: ['migration'],
    parameters: {
      getRepository: () => repository,
      getDatabase: () => 'test'
    },
    result: {
      integrityHash: hashObject(repository),
      database: 'test'
    }
  },
  function: {
    type: FunctionServiceType,
    entryId: 'function',
    dependencies: ['cluster', 'integrity'],
    parameters: {
      version,
      failAlias
    },
    result: {
      version
    }
  }
});

// Same round trip as the state file between two deploys.
const saveState = (state: EntryStates<TestState>): EntryStates<TestState> => {
  return JSON.parse(JSON.stringify(state));
};

const getHandlers = (events: string[]): StepHandlers<TestState> => {
  const clusterHandler: StepHandler<ClusterState> = {
    equals: () => true,
    preview: () => undefined,
    create: (candidate) => candidate.result,
    replace: (candidate) => candidate.result,
    update: (candidate) => candidate.result,
    delete: () => {}
  };

  // Stands in for the function handler: the update publishes a version and a post action switches the alias to it.
  const functionHandler: StepHandler<FunctionState> = {
    equals: () => true,
    preview: (candidate, current) => {
      return deepCompare({ ...candidate.parameters, rollout: true }, { ...current.parameters, rollout: !current.partial });
    },
    create: (candidate) => ({ version: candidate.parameters.version }),
    replace: (candidate) => ({ version: candidate.parameters.version }),
    update: (candidate, _current, context) => {
      const { version, failAlias } = candidate.parameters;

      context.postAction(() => {
        if (failAlias) {
          throw new Error(`Alias switch to ${version} failed.`);
        }

        events.push(`alias ${version}`);

        context.postAction(() => {
          events.push(`unpublish`);
        });
      });

      return { version };
    },
    delete: () => {}
  };

  return {
    [ClusterServiceType]: clusterHandler,
    [MigrationServiceType]: getMigrationHandler(),
    [IntegrityServiceType]: getIntegrityHandler(),
    [FunctionServiceType]: functionHandler
  };
};

const mockDataApi = (t: TestContext, events: string[], invalidIndex?: boolean) => {
  return t.mock.method(RDSDataClient.prototype, 'send', async (command: ExecuteStatementCommand) => {
    if (!(command instanceof ExecuteStatementCommand) || !command.input.sql) {
      throw new Error(`Unexpected ${command.constructor.name} command.`);
    }

    const { sql } = command.input;

    events.push(sql);

    const output: Partial<ExecuteStatementCommandOutput> = {};

    if (invalidIndex && sql === validateIndexQuery) {
      output.columnMetadata = [{ name: 'invalid' }];
      output.records = [[{ longValue: 1 }]];
    }

    return output;
  });
};

const deploy = async (events: string[], newState: EntryStates<TestState>, oldState: EntryStates<TestState>) => {
  const handlers = getHandlers(events);

  // The deploy starts every new entry from the last saved result.
  for (const entryId in newState) {
    const entry = newState[entryId];

    if (entry) {
      entry.result = oldState[entryId]?.result;
    }
  }

  const steps = await planSteps(newState, oldState, { handlers });

  const { result, errors } = await applySteps(steps, newState, oldState, { handlers });

  return {
    state: saveState(result),
    errors: errors.map((error) => error.constructor.name)
  };
};

describe('aurora migration cleanup', () => {
  it('assert :: cleanup after the code switch', async (t) => {
    const events: string[] = [];

    mockDataApi(t, events);

    const { state, errors } = await deploy(events, buildState(newRepository, 'v2'), saveState(buildState(oldRepository, 'v1')));

    deepEqual(events, [validateIndexQuery, 'alias v2', dropColumnQuery, 'unpublish']);
    deepEqual(errors, []);

    ok(!state.migration?.partial);
    ok(!state.integrity?.partial);
    ok(!state.function?.partial);

    deepEqual(state.migration?.result, { clusterArn, secretArn });
  });

  it('assert :: no cleanup when the integrity check fails', async (t) => {
    const events: string[] = [];

    mockDataApi(t, events, true);

    const { state, errors } = await deploy(events, buildState(newRepository, 'v2'), saveState(buildState(oldRepository, 'v1')));

    deepEqual(events, [validateIndexQuery, validateRetryQuery]);

    deepEqual(errors, ['IntegrityCheckFailedError', 'SkipFailedEntryDependencyError', 'SkipFailedEntryDependentError']);

    ok(state.migration?.partial);
    ok(state.integrity?.partial);
    ok(state.function?.partial);

    deepEqual(state.migration?.result, { clusterArn, secretArn, oldRepository });
  });

  it('assert :: no cleanup when the code switch fails', async (t) => {
    const events: string[] = [];

    mockDataApi(t, events);

    const { state, errors } = await deploy(events, buildState(newRepository, 'v2', true), saveState(buildState(oldRepository, 'v1')));

    deepEqual(events, [validateIndexQuery]);

    deepEqual(errors, ['Error', 'SkipFailedEntryDependentError', 'SkipFailedEntryDependencyError']);

    ok(state.migration?.partial);
    ok(state.function?.partial);

    deepEqual(state.migration?.result, { clusterArn, secretArn, oldRepository });
  });

  it('assert :: cleanup on the next deploy after the code switch', async (t) => {
    const events: string[] = [];

    mockDataApi(t, events);

    const { state: failedState } = await deploy(events, buildState(newRepository, 'v2', true), saveState(buildState(oldRepository, 'v1')));

    events.splice(0);

    const { state, errors } = await deploy(events, buildState(newRepository, 'v2'), failedState);

    deepEqual(events, [validateIndexQuery, 'alias v2', dropColumnQuery, 'unpublish']);
    deepEqual(errors, []);

    ok(!state.migration?.partial);
    ok(!state.integrity?.partial);
    ok(!state.function?.partial);

    deepEqual(state.migration?.result, { clusterArn, secretArn });
  });
});
