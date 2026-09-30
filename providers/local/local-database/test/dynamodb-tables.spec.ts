import { deepEqual, equal, ok } from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  CreateTableCommand,
  DescribeTimeToLiveCommand,
  GetItemCommand,
  PutItemCommand,
  QueryCommand,
  StreamViewType
} from '@aws-sdk/client-dynamodb';

import { Logger } from '@ez4/logger';

import {
  describeTable,
  dropTable,
  dynamoDb,
  getDatabaseService,
  getServeOptions,
  getTableName,
  startEmulator,
  stopEmulator
} from './common/dynamodb';

const getIndexStatus = async (tableName: string) => {
  const table = await describeTable(tableName);

  return table?.GlobalSecondaryIndexes?.map(({ IndexName, IndexStatus }) => ({ IndexName, IndexStatus })) ?? [];
};

describe('local dynamodb tables', { timeout: 20000 }, () => {
  it('assert :: create a table with its stream and indexes, without enabling ttl', async () => {
    const service = getDatabaseService('tablesCreateDb', [
      {
        name: 'items',
        stream: true,
        indexes: {
          id: 'primary',
          email: 'secondary',
          expiresAt: 'ttl'
        }
      }
    ]);

    const options = getServeOptions(service.name, { test: true });
    const tableName = getTableName(service.name, 'items', options);

    await dropTable(tableName);

    const emulator = await startEmulator(service, options);

    try {
      const table = await describeTable(tableName);

      deepEqual(table?.StreamSpecification, {
        StreamViewType: StreamViewType.NEW_AND_OLD_IMAGES,
        StreamEnabled: true
      });

      deepEqual(await getIndexStatus(tableName), [
        {
          IndexName: 'email-index',
          IndexStatus: 'ACTIVE'
        }
      ]);

      const { TimeToLiveDescription } = await dynamoDb.send(
        new DescribeTimeToLiveCommand({
          TableName: tableName
        })
      );

      equal(TimeToLiveDescription?.TimeToLiveStatus, 'DISABLED');
    } finally {
      await stopEmulator(emulator);
      await dropTable(tableName);
    }
  });

  it('assert :: enable the stream on an existing table', async () => {
    const indexes = { id: 'primary' };

    const plainService = getDatabaseService('tablesStreamDb', [{ name: 'items', indexes }]);
    const streamService = getDatabaseService('tablesStreamDb', [{ name: 'items', indexes, stream: true }]);

    const options = getServeOptions(plainService.name, { test: true });
    const tableName = getTableName(plainService.name, 'items', options);

    await dropTable(tableName);

    await stopEmulator(await startEmulator(plainService, options));

    equal((await describeTable(tableName))?.StreamSpecification?.StreamEnabled, undefined);

    const emulator = await startEmulator(streamService, options);

    try {
      deepEqual((await describeTable(tableName))?.StreamSpecification, {
        StreamViewType: StreamViewType.NEW_AND_OLD_IMAGES,
        StreamEnabled: true
      });
    } finally {
      await stopEmulator(emulator);
      await dropTable(tableName);
    }
  });

  it('assert :: disable the stream of a table that no longer declares one', async () => {
    const service = getDatabaseService('tablesNoStreamDb', [{ name: 'items', indexes: { id: 'primary' } }]);

    const options = getServeOptions(service.name, { test: true });
    const tableName = getTableName(service.name, 'items', options);

    await dropTable(tableName);

    await dynamoDb.send(
      new CreateTableCommand({
        TableName: tableName,
        BillingMode: 'PAY_PER_REQUEST',
        AttributeDefinitions: [{ AttributeName: 'id', AttributeType: 'S' }],
        KeySchema: [{ AttributeName: 'id', KeyType: 'HASH' }],
        StreamSpecification: {
          StreamViewType: StreamViewType.NEW_AND_OLD_IMAGES,
          StreamEnabled: true
        }
      })
    );

    const emulator = await startEmulator(service, options);

    try {
      equal((await describeTable(tableName))?.StreamSpecification?.StreamEnabled, undefined);
    } finally {
      await stopEmulator(emulator);
      await dropTable(tableName);
    }
  });

  it('assert :: create an index added to an existing table before serving', async () => {
    const oldService = getDatabaseService('tablesAddIndexDb', [{ name: 'items', indexes: { id: 'primary' } }]);
    const newService = getDatabaseService('tablesAddIndexDb', [{ name: 'items', indexes: { id: 'primary', email: 'secondary' } }]);

    const options = getServeOptions(oldService.name, { test: true });
    const tableName = getTableName(oldService.name, 'items', options);

    await dropTable(tableName);

    await stopEmulator(await startEmulator(oldService, options));

    await dynamoDb.send(
      new PutItemCommand({
        TableName: tableName,
        Item: {
          id: { S: 'foo' },
          email: { S: 'foo@ez4.dev' }
        }
      })
    );

    const emulator = await startEmulator(newService, options);

    try {
      deepEqual(await getIndexStatus(tableName), [
        {
          IndexName: 'email-index',
          IndexStatus: 'ACTIVE'
        }
      ]);

      const { Items } = await dynamoDb.send(
        new QueryCommand({
          TableName: tableName,
          IndexName: 'email-index',
          KeyConditionExpression: 'email = :email',
          ExpressionAttributeValues: {
            ':email': { S: 'foo@ez4.dev' }
          }
        })
      );

      deepEqual(Items, [
        {
          id: { S: 'foo' },
          email: { S: 'foo@ez4.dev' }
        }
      ]);
    } finally {
      await stopEmulator(emulator);
      await dropTable(tableName);
    }
  });

  it('assert :: delete an index removed from the table', async () => {
    const oldService = getDatabaseService('tablesDropIndexDb', [{ name: 'items', indexes: { id: 'primary', email: 'secondary' } }]);
    const newService = getDatabaseService('tablesDropIndexDb', [{ name: 'items', indexes: { id: 'primary' } }]);

    const options = getServeOptions(oldService.name, { test: true });
    const tableName = getTableName(oldService.name, 'items', options);

    await dropTable(tableName);

    await stopEmulator(await startEmulator(oldService, options));

    equal((await getIndexStatus(tableName)).length, 1);

    const emulator = await startEmulator(newService, options);

    try {
      deepEqual(await getIndexStatus(tableName), []);
    } finally {
      await stopEmulator(emulator);
      await dropTable(tableName);
    }
  });

  it('assert :: recreate a table whose key schema changed and warn about the dropped data', async (context) => {
    const oldService = getDatabaseService('tablesKeyDb', [{ name: 'items', indexes: { id: 'primary' } }]);
    const newService = getDatabaseService('tablesKeyDb', [{ name: 'items', indexes: { 'id:order': 'primary' } }]);

    const options = getServeOptions(oldService.name, { test: true });
    const tableName = getTableName(oldService.name, 'items', options);

    await dropTable(tableName);

    await stopEmulator(await startEmulator(oldService, options));

    await dynamoDb.send(
      new PutItemCommand({
        TableName: tableName,
        Item: {
          id: { S: 'foo' }
        }
      })
    );

    const warning = context.mock.method(Logger, 'warn', () => {});

    const emulator = await startEmulator(newService, options);

    try {
      deepEqual((await describeTable(tableName))?.KeySchema, [
        { AttributeName: 'id', KeyType: 'HASH' },
        { AttributeName: 'order', KeyType: 'RANGE' }
      ]);

      const { Item } = await dynamoDb.send(
        new GetItemCommand({
          TableName: tableName,
          Key: {
            id: { S: 'foo' },
            order: { N: '0' }
          }
        })
      );

      equal(Item, undefined);

      const messages = warning.mock.calls.map(({ arguments: [message] }) => `${message}`);

      ok(
        messages.some((message) => message.includes(tableName) && message.includes('dropped')),
        `expected a warning about ${tableName}, got ${JSON.stringify(messages)}`
      );
    } finally {
      await stopEmulator(emulator);
      await dropTable(tableName);
    }
  });
});
