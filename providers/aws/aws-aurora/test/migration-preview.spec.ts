import type { PgTableRepository } from '@ez4/pgclient/library';
import type { StepContext } from '@ez4/state';
import type { MigrationState } from '../src/migration/types';

import { describe, it } from 'node:test';
import { deepEqual } from 'node:assert/strict';

import { ExecuteStatementCommand, RDSDataClient } from '@aws-sdk/client-rds-data';

import { SchemaType } from '@ez4/schema';
import { Index } from '@ez4/database';
import { Logger } from '@ez4/logger';

import { getMigrationHandler } from '../src/migration/handler';
import { MigrationServiceType } from '../src/migration/types';

const getRepository = (withRelation: boolean): PgTableRepository => ({
  items: {
    name: 'items',
    indexes: {
      id: { name: 'id', columns: ['id'], type: Index.Primary }
    },
    relations: withRelation
      ? {
          owner: {
            sourceTable: 'owners',
            sourceColumn: 'id',
            sourceIndex: Index.Primary,
            targetColumn: 'owner_id'
          }
        }
      : {},
    schema: {
      type: SchemaType.Object,
      properties: {
        id: { type: SchemaType.String },
        owner_id: { type: SchemaType.String }
      }
    }
  },
  owners: {
    name: 'owners',
    relations: {},
    indexes: {
      id: { name: 'id', columns: ['id'], type: Index.Primary }
    },
    schema: {
      type: SchemaType.Object,
      properties: {
        id: { type: SchemaType.String }
      }
    }
  }
});

const getState = (repository: PgTableRepository): MigrationState => ({
  type: MigrationServiceType,
  entryId: 'migration',
  dependencies: [],
  parameters: {
    database: 'test',
    repository
  }
});

describe('aurora migration preview', () => {
  it('assert :: warns about a new foreign key without an index', (t) => {
    const warnings: string[] = [];

    t.mock.method(Logger, 'warn', (message: string) => {
      warnings.push(message);
    });

    getMigrationHandler().preview(getState(getRepository(true)), getState(getRepository(false)), { force: false });

    deepEqual(warnings, ['Foreign key items.owner_id has no index led by owner_id: deleting or updating a record of owners scans items.']);
  });

  it('assert :: shows the statements the migration runs', async (t) => {
    t.mock.method(Logger, 'warn', () => {});

    const preview = await getMigrationHandler().preview(getState(getRepository(true)), getState(getRepository(false)), { force: false });

    deepEqual(preview?.nested?.statements, {
      counts: 2,
      create: {
        'rollout.1':
          `ALTER TABLE IF EXISTS "items" ADD CONSTRAINT "items_owner_fk" FOREIGN KEY ("owner_id") REFERENCES "owners" ("id") ` +
          `ON DELETE CASCADE ON UPDATE CASCADE NOT VALID`,
        'rollout.2': `ALTER TABLE IF EXISTS "items" VALIDATE CONSTRAINT "items_owner_fk"`
      }
    });
  });

  it('assert :: shows no change when the migration runs outside of the deploy', async (t) => {
    t.mock.method(Logger, 'warn', () => {});

    const candidate = getState(getRepository(true));
    const current = getState(getRepository(false));

    candidate.parameters.disabled = true;
    current.parameters.disabled = true;

    const preview = await getMigrationHandler().preview(candidate, current, { force: false });

    deepEqual(preview?.counts, 0);
    deepEqual(preview?.nested?.repository, undefined);
    deepEqual(preview?.nested?.statements, undefined);
  });

  it('assert :: keeps a database migrated outside of the deploy', async (t) => {
    const statements: string[] = [];
    const warnings: string[] = [];

    t.mock.method(RDSDataClient.prototype, 'send', async (command: ExecuteStatementCommand) => {
      statements.push(command.input.sql ?? '');
      return {};
    });

    const current = getState(getRepository(true));

    current.parameters.disabled = true;
    current.result = {
      clusterArn: 'arn:aws:rds:us-east-1:000000000000:cluster:test',
      secretArn: 'arn:aws:secretsmanager:us-east-1:000000000000:secret:test'
    };

    const context: StepContext = {
      force: true,
      getDependencies: () => [],
      getDependents: () => [],
      getConnections: () => [],
      postAction: () => {},
      addWarning: (message) => warnings.push(message)
    };

    await getMigrationHandler().delete(current, context);

    deepEqual(statements, []);
    deepEqual(warnings, [`Database 'test' is migrated outside of the deploy and isn't deleted.`]);
  });
});
