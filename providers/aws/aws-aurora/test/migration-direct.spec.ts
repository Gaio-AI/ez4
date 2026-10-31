import type { PgMigrationStatement } from '@ez4/pgmigration/library';
import type { PoolConfig } from 'pg';

import { describe, it, beforeEach, afterEach, mock } from 'node:test';
import { deepEqual, equal, ok, rejects } from 'node:assert/strict';
import { EventEmitter } from 'node:events';

import pg from 'pg';

import { DescribeDBClustersCommand, RDSClient } from '@aws-sdk/client-rds';
import { RDSDataClient } from '@aws-sdk/client-rds-data';
import { SecretsManagerClient } from '@aws-sdk/client-secrets-manager';

import { modifyDatabase } from '../src/migration/client';
import { validateChanges } from '../src/integrity/client';

const clusterArn = 'arn:aws:rds:us-east-1:000000000000:cluster:test';
const secretArn = 'arn:aws:secretsmanager:us-east-1:000000000000:secret:test';

const WriterEndpoint = 'test.cluster-abc.us-east-1.rds.amazonaws.com';

const logger = {
  update: () => {}
};

const alterQuery = `ALTER TABLE IF EXISTS "items" ADD COLUMN IF NOT EXISTS "other" text`;
const lockedAlterQuery = `DO $ez4$ BEGIN PERFORM set_config('lock_timeout', '5s', true); ${alterQuery}; END $ez4$`;

const modify = (statements: PgMigrationStatement[]) => {
  return modifyDatabase(logger, { clusterArn, secretArn, database: 'test', statements });
};

const pgError = (code: string, message: string) => {
  return Object.assign(new Error(message), { code });
};

/**
 * Migrations and integrity checks of a deploy that reaches the writer (inside its VPC or through a tunnel): the
 * statements go over a pg connection to the writer, signed in with the cluster secret, and never through the Data API.
 */
describe('aurora direct migration', () => {
  let poolOptions: PoolConfig[];
  let statements: string[];

  // Answers each statement in order: an error to throw, or nothing to succeed with no rows.
  let answers: Record<string, (Error | undefined)[]>;

  beforeEach(() => {
    poolOptions = [];
    statements = [];
    answers = {};

    process.env.AWS_REGION = 'us-east-1';
    process.env.EZ4_AURORA_CONNECTION = 'direct';

    delete process.env.EZ4_AURORA_TUNNELS;

    mock.method(RDSClient.prototype, 'send', async (command: DescribeDBClustersCommand) => {
      equal(command.input.DBClusterIdentifier, clusterArn);

      return {
        DBClusters: [
          {
            DBClusterArn: clusterArn,
            Endpoint: WriterEndpoint,
            ReaderEndpoint: 'test.cluster-ro-abc.us-east-1.rds.amazonaws.com',
            MasterUserSecret: { SecretArn: secretArn }
          }
        ]
      };
    });

    mock.method(SecretsManagerClient.prototype, 'send', async () => {
      return { SecretString: JSON.stringify({ username: 'master', password: 'secret' }) };
    });

    mock.method(RDSDataClient.prototype, 'send', async () => {
      throw new Error('The Data API must not be called.');
    });

    mock.method(pg.Pool.prototype, 'connect', async function (this: pg.Pool & { options: PoolConfig }) {
      poolOptions.push(this.options);

      return Object.assign(new EventEmitter(), {
        query: async (statement: string | { text: string }) => {
          const text = typeof statement === 'string' ? statement : statement.text;

          statements.push(text);

          const answer = answers[text]?.shift();

          if (answer instanceof Error) {
            throw answer;
          }

          return { rows: [], rowCount: 0 };
        },
        release: () => {}
      });
    });
  });

  afterEach(() => {
    mock.restoreAll();

    delete process.env.EZ4_AURORA_CONNECTION;
    delete process.env.EZ4_AURORA_TUNNELS;
  });

  it('assert :: statements go to the writer over a pg connection, signed in with the cluster secret', async () => {
    await modify([{ name: 'alter items', query: alterQuery }]);

    deepEqual(statements, [lockedAlterQuery]);

    const [options] = poolOptions;

    ok(options);

    equal(options.host, WriterEndpoint);
    equal(options.port, undefined);
    equal(options.database, 'test');
    equal(options.user, 'master');
  });

  it('assert :: through a tunnel, it connects to its local end and still checks the writer certificate', async () => {
    process.env.EZ4_AURORA_TUNNELS = `other.cluster.rds.amazonaws.com=127.0.0.1:15433, ${WriterEndpoint}=127.0.0.1:15432`;

    await modify([{ name: 'alter items', query: alterQuery }]);

    const [options] = poolOptions;

    ok(options);

    equal(options.host, '127.0.0.1');
    equal(options.port, 15432);

    const ssl = options.ssl;

    ok(ssl && typeof ssl === 'object');

    equal(ssl.servername, WriterEndpoint);
    ok(ssl.checkServerIdentity);
  });

  it('assert :: a statement that times out waiting for a lock runs again', async () => {
    answers[lockedAlterQuery] = [pgError('55P03', 'canceling statement due to lock timeout')];

    await modify([{ name: 'alter items', query: alterQuery }]);

    deepEqual(statements, [lockedAlterQuery, lockedAlterQuery]);
  });

  it('assert :: a statement that fails otherwise fails the migration', async () => {
    answers[lockedAlterQuery] = [pgError('42P01', 'relation "items" does not exist')];

    await rejects(() => modify([{ name: 'alter items', query: alterQuery }]), /relation "items" does not exist/);

    deepEqual(statements, [lockedAlterQuery]);
  });

  it('assert :: integrity checks go to the writer as well', async () => {
    const check = `SELECT 1 WHERE to_regclass('items_other_sk') IS NULL`;
    const retry = `SELECT 1 FROM "pg_stat_progress_create_index"`;

    await validateChanges(logger, {
      clusterArn,
      secretArn,
      database: 'test',
      queries: [{ name: 'items_other_sk', check, retry }]
    });

    deepEqual(statements, [check]);
    equal(poolOptions[0]?.host, WriterEndpoint);
  });

  it('assert :: the pool keeps a connection for each integrity check that runs alongside the others', async () => {
    await modify([{ name: 'alter items', query: alterQuery }]);

    equal(poolOptions[0]?.max, 5);
  });

  it('assert :: a tunnel entry out of shape is refused', async () => {
    process.env.EZ4_AURORA_TUNNELS = `${WriterEndpoint}:15432`;

    await rejects(() => modify([{ name: 'alter items', query: alterQuery }]), /EZ4_AURORA_TUNNELS/);

    deepEqual(statements, []);
  });

  it('assert :: an unknown connection mode is refused', async () => {
    process.env.EZ4_AURORA_CONNECTION = 'dirct';

    await rejects(() => modify([{ name: 'alter items', query: alterQuery }]), /EZ4_AURORA_CONNECTION/);

    deepEqual(statements, []);
  });
});
