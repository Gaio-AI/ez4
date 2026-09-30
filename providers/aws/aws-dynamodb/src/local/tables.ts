import type { AttributeDefinition, KeySchemaElement, TableDescription } from '@aws-sdk/client-dynamodb';
import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import type { DatabaseService } from '@ez4/database/library';
import type { ServeOptions } from '@ez4/project/library';
import type { AttributeSchema, AttributeSchemaGroup } from '../types/schema';

import { getServiceName } from '@ez4/project/library';
import { Logger } from '@ez4/logger';

import { setTimeout } from 'node:timers/promises';

import {
  CreateTableCommand,
  DeleteTableCommand,
  DescribeTableCommand,
  UpdateTableCommand,
  ResourceNotFoundException,
  ResourceInUseException,
  StreamViewType,
  BillingMode,
  IndexStatus,
  TableStatus
} from '@aws-sdk/client-dynamodb';

import { getSecondaryIndexes, getSecondaryIndexName } from '../table/helpers/indexes';
import { getAttributeDefinitions, getAttributeKeyTypes } from '../table/helpers/schema';
import { getAttributeSchema } from '../utils/schema';
import { getTableName } from '../utils/table';
import { LocalTableNotReadyError } from './errors';

type LocalTable = {
  tableName: string;
  attributeSchema: AttributeSchemaGroup[];
  enableStream: boolean;
};

const WAIT_DELAY = 100;
const WAIT_ATTEMPTS = 600;

// The table's own TTL stays off: `serve` and `test` share table names, so DynamoDB Local would also delete
// the expired fixtures of tests. In `serve`, the local sweeper deletes the expired items instead.
export const syncAllTables = async (client: DynamoDBDocumentClient, service: DatabaseService, options: ServeOptions) => {
  const tablePrefix = getServiceName(service, options);

  for (const table of service.tables) {
    const { attributeSchema } = getAttributeSchema(table.indexes, table.schema);

    await syncTable(client, {
      tableName: getTableName(tablePrefix, table),
      enableStream: !!table.stream,
      attributeSchema
    });
  }
};

export const deleteAllTables = async (client: DynamoDBDocumentClient, service: DatabaseService, options: ServeOptions) => {
  const tablePrefix = getServiceName(service, options);

  for (const table of service.tables) {
    const tableName = getTableName(tablePrefix, table);

    await deleteTable(client, tableName);
  }
};

const syncTable = async (client: DynamoDBDocumentClient, table: LocalTable) => {
  const { tableName, attributeSchema } = table;

  const currentTable = await waitForTable(client, tableName);

  if (!currentTable) {
    await createTable(client, table);
    await waitForTable(client, tableName);
    return;
  }

  const [primarySchema] = attributeSchema;

  if (getSchemaSignature(primarySchema) !== getKeySignature(currentTable.KeySchema, currentTable.AttributeDefinitions)) {
    await deleteTable(client, tableName);
    await createTable(client, table);
    await waitForTable(client, tableName);

    Logger.warn(`Table ${tableName} was recreated with its new key schema, the local data was dropped.`);
    return;
  }

  await syncStream(client, currentTable, table);
  await syncSecondaryIndexes(client, currentTable, table);
};

const createTable = async (client: DynamoDBDocumentClient, table: LocalTable) => {
  const [primarySchema, ...secondarySchema] = table.attributeSchema;

  try {
    await client.send(
      new CreateTableCommand({
        TableName: table.tableName,
        AttributeDefinitions: getAttributeDefinitions([...secondarySchema.flat(), ...primarySchema]),
        KeySchema: getAttributeKeyTypes(primarySchema),
        BillingMode: BillingMode.PAY_PER_REQUEST,
        ...(secondarySchema.length && {
          GlobalSecondaryIndexes: getSecondaryIndexes(...secondarySchema)
        }),
        ...(table.enableStream && {
          StreamSpecification: {
            StreamViewType: StreamViewType.NEW_AND_OLD_IMAGES,
            StreamEnabled: true
          }
        })
      })
    );
  } catch (error) {
    if (!(error instanceof ResourceInUseException)) {
      throw error;
    }
  }
};

const deleteTable = async (client: DynamoDBDocumentClient, tableName: string) => {
  try {
    await client.send(
      new DeleteTableCommand({
        TableName: tableName
      })
    );

    await waitForDeletion(client, tableName);
  } catch (error) {
    if (!(error instanceof ResourceNotFoundException)) {
      throw error;
    }
  }
};

const syncStream = async (client: DynamoDBDocumentClient, currentTable: TableDescription, table: LocalTable) => {
  const { StreamEnabled, StreamViewType: currentViewType } = currentTable.StreamSpecification ?? {};

  const isStreamEnabled = !!StreamEnabled;
  const isStreamReady = isStreamEnabled && currentViewType === StreamViewType.NEW_AND_OLD_IMAGES;

  if (table.enableStream ? isStreamReady : !isStreamEnabled) {
    return;
  }

  // The view type of an enabled stream only changes by disabling it first.
  if (isStreamEnabled) {
    await updateStream(client, table.tableName, false);
  }

  if (table.enableStream) {
    await updateStream(client, table.tableName, true);
  }
};

const updateStream = async (client: DynamoDBDocumentClient, tableName: string, enableStream: boolean) => {
  await client.send(
    new UpdateTableCommand({
      TableName: tableName,
      StreamSpecification: {
        StreamEnabled: enableStream,
        ...(enableStream && {
          StreamViewType: StreamViewType.NEW_AND_OLD_IMAGES
        })
      }
    })
  );

  await waitForTable(client, tableName);
};

const syncSecondaryIndexes = async (client: DynamoDBDocumentClient, currentTable: TableDescription, table: LocalTable) => {
  const [, ...secondarySchema] = table.attributeSchema;

  const currentIndexes = new Map<string, string>();

  for (const { IndexName, KeySchema } of currentTable.GlobalSecondaryIndexes ?? []) {
    if (IndexName) {
      currentIndexes.set(IndexName, getKeySignature(KeySchema, currentTable.AttributeDefinitions));
    }
  }

  const declaredIndexes = new Map(secondarySchema.map((schema) => [getSecondaryIndexName(schema), schema]));

  // Removed and changed indexes go first, so a changed index frees its attribute definitions.
  for (const [indexName, keySignature] of currentIndexes) {
    const indexSchema = declaredIndexes.get(indexName);

    if (!indexSchema || getSchemaSignature(indexSchema) !== keySignature) {
      await deleteIndex(client, table.tableName, indexName);

      currentIndexes.delete(indexName);
    }
  }

  for (const [indexName, indexSchema] of declaredIndexes) {
    if (!currentIndexes.has(indexName)) {
      await createIndex(client, table.tableName, indexSchema);
    }
  }
};

const createIndex = async (client: DynamoDBDocumentClient, tableName: string, indexSchema: AttributeSchemaGroup) => {
  const [globalIndex] = getSecondaryIndexes(indexSchema);

  await client.send(
    new UpdateTableCommand({
      TableName: tableName,
      AttributeDefinitions: getAttributeDefinitions(indexSchema),
      GlobalSecondaryIndexUpdates: [
        {
          Create: globalIndex
        }
      ]
    })
  );

  await waitForTable(client, tableName);
};

const deleteIndex = async (client: DynamoDBDocumentClient, tableName: string, indexName: string) => {
  await client.send(
    new UpdateTableCommand({
      TableName: tableName,
      GlobalSecondaryIndexUpdates: [
        {
          Delete: {
            IndexName: indexName
          }
        }
      ]
    })
  );

  await waitForTable(client, tableName);
};

const getSchemaSignature = (schema: AttributeSchema[]) => {
  return getKeySignature(getAttributeKeyTypes(schema), getAttributeDefinitions(schema));
};

const getKeySignature = (keySchema: KeySchemaElement[] = [], attributeDefinitions: AttributeDefinition[] = []) => {
  const keyTypes = keySchema.map(({ AttributeName, KeyType }) => {
    const definition = attributeDefinitions.find((attribute) => attribute.AttributeName === AttributeName);

    return `${AttributeName}:${definition?.AttributeType}:${KeyType}`;
  });

  return keyTypes.join(',');
};

const describeTable = async (client: DynamoDBDocumentClient, tableName: string) => {
  try {
    const { Table } = await client.send(
      new DescribeTableCommand({
        TableName: tableName
      })
    );

    return Table;
  } catch (error) {
    if (!(error instanceof ResourceNotFoundException)) {
      throw error;
    }

    return undefined;
  }
};

// Local tables only serve once the table and every index are ACTIVE, DynamoDB Local runs
// index changes through CREATING and DELETING.
const waitForTable = async (client: DynamoDBDocumentClient, tableName: string) => {
  for (let attempt = 0; attempt < WAIT_ATTEMPTS; attempt++) {
    const table = await describeTable(client, tableName);

    if (!table || isTableActive(table)) {
      return table;
    }

    await setTimeout(WAIT_DELAY);
  }

  throw new LocalTableNotReadyError(tableName);
};

const waitForDeletion = async (client: DynamoDBDocumentClient, tableName: string) => {
  for (let attempt = 0; attempt < WAIT_ATTEMPTS; attempt++) {
    if (!(await describeTable(client, tableName))) {
      return;
    }

    await setTimeout(WAIT_DELAY);
  }

  throw new LocalTableNotReadyError(tableName);
};

const isTableActive = (table: TableDescription) => {
  const allIndexes = table.GlobalSecondaryIndexes ?? [];

  return table.TableStatus === TableStatus.ACTIVE && allIndexes.every(({ IndexStatus: status }) => status === IndexStatus.ACTIVE);
};
