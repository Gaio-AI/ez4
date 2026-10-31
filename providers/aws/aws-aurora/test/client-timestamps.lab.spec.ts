import type { Database, Client as DbClient } from '@ez4/database';
import type { PgTableRepository } from '@ez4/pgclient/library';
import type { PostgresEngine } from '@ez4/pgclient';
import type { EntryStates } from '@ez4/state';
import type { String } from '@ez4/schema';

import { before, after, describe, it } from 'node:test';
import { deepEqual, equal, match, notEqual, ok } from 'node:assert/strict';
import { setTimeout } from 'node:timers/promises';
import { randomUUID } from 'node:crypto';

import { Client } from '@ez4/aws-aurora/client/api';
import { SchemaType } from '@ez4/schema';
import { deploy } from '@ez4/aws-common';
import { Index } from '@ez4/database';
import { deepClone } from '@ez4/utils';

import { createCluster, createInstance, createMigration, isClusterState, isMigrationState, registerTriggers } from '@ez4/aws-aurora';

declare class Test extends Database.Service<PostgresEngine> {
  tables: [
    {
      name: 'ez4_test_timestamps';
      timestamps: {
        created: 'created_at';
        updated: 'updated_at';
      };
      indexes: {
        id: Index.Primary;
      };
      schema: {
        id: string;
        name: string;
        created_at: String.DateTime;
        updated_at: String.DateTime;
      };
    }
  ];
}

const getRepository = (withTimestamps: boolean): PgTableRepository => ({
  ez4_test_timestamps: {
    name: 'ez4_test_timestamps',
    relations: {},
    ...(withTimestamps && {
      timestamps: {
        created: 'created_at',
        updated: 'updated_at'
      }
    }),
    indexes: {
      id: {
        name: 'id',
        columns: ['id'],
        type: Index.Primary
      }
    },
    schema: {
      type: SchemaType.Object,
      properties: {
        id: {
          type: SchemaType.String,
          format: 'uuid'
        },
        name: {
          type: SchemaType.String
        },
        created_at: {
          type: SchemaType.String,
          format: 'date-time'
        },
        updated_at: {
          type: SchemaType.String,
          format: 'date-time'
        }
      }
    }
  }
});

const createLocalState = (repository: PgTableRepository) => {
  const localState: EntryStates = {};

  const clusterState = createCluster(localState, {
    clusterName: 'ez4-test-cluster-client',
    allowDeletion: false,
    enableHttp: true,
    scalability: {
      maxCapacity: 1,
      minCapacity: 0
    }
  });

  const instanceState = createInstance(localState, clusterState, {
    instanceName: 'ez4-test-instance-client'
  });

  const migrationState = createMigration(localState, clusterState, instanceState, {
    database: 'ez4_test_timestamps',
    repository
  });

  return {
    localState,
    clusterId: clusterState.entryId,
    migrationId: migrationState.entryId,
    database: migrationState.parameters.database
  };
};

const assertDeploy = async (newState: EntryStates, oldState: EntryStates | undefined, clusterId: string) => {
  const { result, errors } = await deploy(newState, oldState);

  deepEqual(errors, []);

  const resultResource = result[clusterId];

  ok(resultResource && isClusterState(resultResource));
  ok(resultResource.result);

  return {
    state: result,
    resourceArn: resultResource.result.clusterArn,
    secretArn: resultResource.result.secretArn!
  };
};

const PAST = '2020-01-01T00:00:00.000Z';

const MILLISECOND_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

describe('aurora client timestamps', { timeout: 900000 }, async () => {
  let dbClient: DbClient<Test>;

  const existingId = randomUUID();

  registerTriggers();

  // The table exists before it declares timestamps, so the second deploy runs the prepare statements of an existing
  // table through the Data API, the way a production table gains them. It starts from the deployed state, as a deploy
  // does: a migration entry without the cluster's result would be replaced instead of updated.
  before(async () => {
    const { localState, clusterId, migrationId, database } = createLocalState(getRepository(false));

    const { state, resourceArn, secretArn } = await assertDeploy(localState, undefined, clusterId);

    const connection = { database, resourceArn, secretArn };

    const plainClient: DbClient<Test> = Client.make({ repository: getRepository(false), connection });

    await plainClient.rawQuery(`DELETE FROM "ez4_test_timestamps"`);

    await plainClient.rawQuery(
      `INSERT INTO "ez4_test_timestamps" ("id", "name", "created_at", "updated_at") VALUES (:id::uuid, 'existing', :at::timestamptz, :at::timestamptz)`,
      { id: existingId, at: PAST }
    );

    const timestampedState = deepClone(state);
    const migrationEntry = timestampedState[migrationId];

    ok(migrationEntry && isMigrationState(migrationEntry));

    migrationEntry.parameters.repository = getRepository(true);

    await assertDeploy(timestampedState, state, clusterId);

    dbClient = Client.make({ repository: getRepository(true), connection });
  });

  after(async () => {
    await dbClient.rawQuery(`DROP TABLE IF EXISTS "ez4_test_timestamps"`);
    await dbClient.rawQuery(`DROP FUNCTION IF EXISTS "ez4_stamp_updated_at"()`);
  });

  it('assert :: the migration created the defaults and the trigger', async () => {
    const triggers = await dbClient.rawQuery(
      `SELECT tgname FROM pg_trigger WHERE tgrelid = 'ez4_test_timestamps'::regclass AND NOT tgisinternal`
    );

    equal(triggers.length, 1);
    equal(triggers[0].tgname, 'ez4_stamp_updated_at');

    const defaults = await dbClient.rawQuery(
      `SELECT column_name, column_default FROM information_schema.columns ` +
        `WHERE table_name = 'ez4_test_timestamps' AND column_name IN ('created_at', 'updated_at') ORDER BY column_name`
    );

    equal(defaults.length, 2);

    for (const { column_default } of defaults) {
      match(String(column_default), /date_trunc\('milliseconds'.*statement_timestamp\(\)\)/);
    }
  });

  it('assert :: the existing record keeps its timestamps', async () => {
    const record = await dbClient.ez4_test_timestamps.findOne({
      select: {
        created_at: true,
        updated_at: true
      },
      where: {
        id: existingId
      }
    });

    equal(record?.created_at, PAST);
    equal(record?.updated_at, PAST);
  });

  it('assert :: an insert without timestamps gets both from the database', async () => {
    const id = randomUUID();

    await dbClient.ez4_test_timestamps.insertOne({
      data: {
        id,
        name: 'inserted'
      }
    });

    const record = await dbClient.ez4_test_timestamps.findOne({
      select: {
        created_at: true,
        updated_at: true
      },
      where: {
        id
      }
    });

    ok(record);

    match(record.created_at, MILLISECOND_DATE_TIME);
    equal(record.updated_at, record.created_at);

    ok(Date.now() - Date.parse(record.created_at) < 60000);
  });

  it('assert :: an update bumps the update timestamp only', async () => {
    await dbClient.ez4_test_timestamps.updateOne({
      data: {
        name: 'updated'
      },
      where: {
        id: existingId
      }
    });

    const record = await dbClient.ez4_test_timestamps.findOne({
      select: {
        created_at: true,
        updated_at: true
      },
      where: {
        id: existingId
      }
    });

    equal(record?.created_at, PAST);
    notEqual(record?.updated_at, PAST);
    match(record!.updated_at, MILLISECOND_DATE_TIME);
  });

  it('assert :: a touch with nothing else to change bumps the update timestamp', async () => {
    const before = await dbClient.ez4_test_timestamps.findOne({
      select: {
        updated_at: true
      },
      where: {
        id: existingId
      }
    });

    await setTimeout(20);

    await dbClient.ez4_test_timestamps.updateOne({
      touch: true,
      data: {},
      where: {
        id: existingId
      }
    });

    const after = await dbClient.ez4_test_timestamps.findOne({
      select: {
        updated_at: true
      },
      where: {
        id: existingId
      }
    });

    ok(before && after);
    ok(Date.parse(after.updated_at) > Date.parse(before.updated_at));
  });

  it('assert :: a raw update giving its own timestamp is overridden', async () => {
    await dbClient.rawQuery(`UPDATE "ez4_test_timestamps" SET "updated_at" = :at::timestamptz WHERE "id" = :id::uuid`, {
      id: existingId,
      at: PAST
    });

    const record = await dbClient.ez4_test_timestamps.findOne({
      select: {
        updated_at: true
      },
      where: {
        id: existingId
      }
    });

    notEqual(record?.updated_at, PAST);
  });
});
