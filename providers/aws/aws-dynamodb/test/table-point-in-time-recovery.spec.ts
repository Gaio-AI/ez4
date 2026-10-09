import type { DeployOptions, EventContext } from '@ez4/project/library';
import type { DatabaseService } from '@ez4/database/library';
import type { TableParameters } from '@ez4/aws-dynamodb';
import type { EntryStates } from '@ez4/state';

import { afterEach, describe, it, mock } from 'node:test';
import { deepEqual, equal, ok } from 'node:assert/strict';

import { CreateTableCommand, DescribeTableCommand, DynamoDBClient, UpdateContinuousBackupsCommand } from '@aws-sdk/client-dynamodb';
import { createTable, isTableState, registerTriggers, AttributeKeyType, AttributeType } from '@ez4/aws-dynamodb';
import { isDatabaseService } from '@ez4/database/library';
import { buildMetadata } from '@ez4/project/library';
import { deploy } from '@ez4/aws-common';
import { deepClone } from '@ez4/utils';

import { prepareDatabaseServices } from '../src/triggers/service';

const tableName = 'ez4-test-recovery';

const tableArn = `arn:aws:dynamodb:us-east-1:000000000000:table/${tableName}`;

// Answers every call like an active table, failing the first `unavailable` backup updates the way
// DynamoDB does right after a table is created, and keeps every backup update sent.
const mockDynamoDb = (unavailable = 0) => {
  const backupUpdates: (boolean | undefined)[] = [];

  let failures = unavailable;

  mock.method(DynamoDBClient.prototype, 'send', async (command: unknown) => {
    if (command instanceof UpdateContinuousBackupsCommand) {
      if (failures-- > 0) {
        throw Object.assign(new Error('Backups are being enabled for the table.'), {
          name: 'ContinuousBackupsUnavailableException'
        });
      }

      backupUpdates.push(command.input.PointInTimeRecoverySpecification?.PointInTimeRecoveryEnabled);

      return {};
    }

    if (command instanceof CreateTableCommand || command instanceof DescribeTableCommand) {
      return {
        Table: { TableName: tableName, TableArn: tableArn, TableStatus: 'ACTIVE' },
        TableDescription: { TableName: tableName, TableArn: tableArn, TableStatus: 'ACTIVE' }
      };
    }

    return {};
  });

  return backupUpdates;
};

const getTableState = (parameters: Partial<TableParameters>) => {
  const state: EntryStates = {};

  const resource = createTable(state, {
    tableName,
    attributeSchema: [
      [
        {
          attributeName: 'id',
          attributeType: AttributeType.String,
          keyType: AttributeKeyType.Hash
        }
      ]
    ],
    ...parameters
  });

  return {
    entryId: resource.entryId,
    state
  };
};

const deployTable = async (newState: EntryStates, oldState?: EntryStates) => {
  const { result, errors } = await deploy(newState, oldState);

  deepEqual(errors, []);

  return result;
};

// The next deploy of the same table: the deployed state with its parameters changed.
const nextDeploy = (lastState: EntryStates, entryId: string, change: (parameters: TableParameters) => void) => {
  const nextState = deepClone(lastState);
  const resource = nextState[entryId];

  ok(resource && isTableState(resource));

  change(resource.parameters);

  return nextState;
};

// The services declared in `test/input/recovery-service.ts`, as the deploy reads them.
const getService = (serviceName: 'RecoveryDb' | 'PlainDb') => {
  const { metadata } = buildMetadata(['./test/input/recovery-service.ts']);

  const service = metadata[serviceName];

  ok(service && isDatabaseService(service));

  return service;
};

const getTableParameters = (service: DatabaseService) => {
  const state: EntryStates = {};

  const options = {
    prefix: 'ez4',
    projectName: 'recovery',
    branchName: ''
  } as DeployOptions;

  const context = {
    setServiceState: () => {},
    setVirtualServiceState: () => {},
    getServiceState: () => {
      throw new Error('No service state.');
    }
  } as unknown as EventContext;

  prepareDatabaseServices({ state, service, metadata: {}, options, context });

  const [tableState] = Object.values(state).filter((entry) => entry && isTableState(entry));

  ok(tableState && isTableState(tableState));

  return tableState.parameters;
};

describe('dynamodb table point-in-time recovery', () => {
  registerTriggers();

  afterEach(() => {
    mock.restoreAll();
  });

  it('assert :: a service with point-in-time recovery turns it on for its tables', () => {
    const parameters = getTableParameters(getService('RecoveryDb'));

    equal(parameters.pointInTimeRecovery, true);
  });

  it('assert :: a service without point-in-time recovery leaves the table parameters as they were', () => {
    // A new key, even an undefined one, would show up as a change in the plan of existing tables.
    ok(!('pointInTimeRecovery' in getTableParameters(getService('PlainDb'))));
  });

  it('assert :: create turns point-in-time recovery on once the table takes it', { timeout: 60_000 }, async () => {
    const backupUpdates = mockDynamoDb(2);

    await deployTable(getTableState({ pointInTimeRecovery: true }).state);

    deepEqual(backupUpdates, [true]);
  });

  it('assert :: create without point-in-time recovery leaves the backups alone', async () => {
    const backupUpdates = mockDynamoDb();

    await deployTable(getTableState({}).state);

    deepEqual(backupUpdates, []);
  });

  it('assert :: update turns point-in-time recovery on and off', async () => {
    const backupUpdates = mockDynamoDb();

    const { entryId, state } = getTableState({});

    const withoutRecovery = await deployTable(state);

    const withRecovery = await deployTable(
      nextDeploy(withoutRecovery, entryId, (parameters) => {
        parameters.pointInTimeRecovery = true;
      }),
      withoutRecovery
    );

    await deployTable(
      nextDeploy(withRecovery, entryId, (parameters) => {
        delete parameters.pointInTimeRecovery;
      }),
      withRecovery
    );

    deepEqual(backupUpdates, [true, false]);
  });

  it('assert :: update of a table that never declared it leaves recovery set outside the code', async () => {
    const backupUpdates = mockDynamoDb();

    const { entryId, state } = getTableState({});

    const current = await deployTable(state);

    await deployTable(
      nextDeploy(current, entryId, (parameters) => {
        parameters.allowDeletion = true;
      }),
      current
    );

    deepEqual(backupUpdates, []);
  });
});
