import type { OperationType, GetRecordsCommandOutput, _Record } from '@aws-sdk/client-dynamodb-streams';
import type { ObservedEvent, StreamRequest } from './fixtures/stream-handler';

import { deepEqual, equal, match, ok } from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { setTimeout } from 'node:timers/promises';

import { DeleteItemCommand, PutItemCommand, UpdateItemCommand, UpdateTableCommand, StreamViewType } from '@aws-sdk/client-dynamodb';
import { DynamoDBStreamsClient, GetRecordsCommand } from '@aws-sdk/client-dynamodb-streams';
import { StreamChangeType } from '@ez4/database';
import { Logger } from '@ez4/logger';

import {
  UUID_PATTERN,
  createTestContext,
  dropTable,
  dynamoDb,
  getDatabaseService,
  getServeOptions,
  getTableName,
  observeChanges,
  observeEvents,
  resetObservers,
  startEmulator,
  stopEmulator,
  waitUntil
} from './common/dynamodb';

const getChange = (request: StreamRequest) => {
  const { requestId, traceId, ...change } = request;

  return change;
};

const getEventTypes = (events: ObservedEvent[]) => {
  return events.map(({ type }) => type);
};

const putItem = (tableName: string, id: string) => {
  return dynamoDb.send(
    new PutItemCommand({
      TableName: tableName,
      Item: {
        id: { S: id }
      }
    })
  );
};

describe('local dynamodb streams', { timeout: 20000 }, () => {
  afterEach(() => {
    resetObservers();
  });

  it('assert :: run the stream handler for inserts, updates and deletes in order', async () => {
    const service = getDatabaseService(
      'streamsChangesDb',
      [
        {
          name: 'items',
          indexes: { id: 'primary' },
          references: ['linkedQueue'],
          stream: true
        }
      ],
      {
        linkedQueue: { reference: 'linkedQueue' },
        otherQueue: { reference: 'otherQueue' }
      }
    );

    const options = getServeOptions(service.name);
    const tableName = getTableName(service.name, 'items', options);

    const clients = { linkedQueue: 'client' };
    const { context, linkedServices } = createTestContext(clients);

    const events = observeEvents();

    const changes = observeChanges(async ({ request }) => {
      // A slow first record shows the next one waits for it.
      if (request.type === StreamChangeType.Insert) {
        await setTimeout(200);
      }
    });

    await dropTable(tableName);

    const emulator = await startEmulator(service, options, context);

    try {
      await dynamoDb.send(
        new PutItemCommand({
          TableName: tableName,
          Item: {
            id: { S: 'foo' },
            value: { N: '1' }
          }
        })
      );

      await dynamoDb.send(
        new UpdateItemCommand({
          TableName: tableName,
          Key: {
            id: { S: 'foo' }
          },
          UpdateExpression: 'SET #value = :value',
          ExpressionAttributeNames: {
            '#value': 'value'
          },
          ExpressionAttributeValues: {
            ':value': { N: '2' }
          }
        })
      );

      await dynamoDb.send(
        new DeleteItemCommand({
          TableName: tableName,
          Key: {
            id: { S: 'foo' }
          }
        })
      );

      ok(await waitUntil(() => changes.length === 3), `expected 3 changes, got ${changes.length}`);

      deepEqual(
        changes.map(({ request }) => getChange(request)),
        [
          {
            type: 'insert',
            record: { id: 'foo', value: 1 }
          },
          {
            type: 'update',
            newRecord: { id: 'foo', value: 2 },
            oldRecord: { id: 'foo', value: 1 }
          },
          {
            type: 'delete',
            record: { id: 'foo', value: 2 }
          }
        ]
      );

      for (const { request, scope, context } of changes) {
        match(request.requestId, UUID_PATTERN);
        match(request.traceId ?? '', UUID_PATTERN);

        deepEqual(scope, { traceId: request.traceId });

        equal(context, clients);
      }

      equal(new Set(changes.map(({ request }) => request.traceId)).size, 3);

      ok(linkedServices.length > 0);

      for (const services of linkedServices) {
        deepEqual(services, { linkedQueue: { reference: 'linkedQueue' } });
      }

      ok(await waitUntil(() => events.length === 12), `expected 12 listener events, got ${events.length}`);

      deepEqual(getEventTypes(events), ['begin', 'ready', 'done', 'end', 'begin', 'ready', 'done', 'end', 'begin', 'ready', 'done', 'end']);

      changes.forEach(({ request }, index) => {
        const group = events.slice(index * 4, index * 4 + 4);

        ok(group.every((event) => event.request.requestId === request.requestId));

        deepEqual(group[1].request, request);
        deepEqual(group[2].request, request);
      });
    } finally {
      await stopEmulator(emulator);
      await dropTable(tableName);
    }
  });

  it('assert :: treat a ttl removal record from dynamodb local as a delete', async (context) => {
    const service = getDatabaseService('streamsTtlRecordDb', [
      { name: 'items', indexes: { id: 'primary', expiresAt: 'ttl' }, stream: true }
    ]);

    const options = getServeOptions(service.name);
    const tableName = getTableName(service.name, 'items', options);

    const changes = observeChanges();

    // DynamoDB Local reports its own TTL removals with this event name, an old image and no user identity.
    const ttlRecord: _Record = {
      eventID: 'b0c8f1c6-6f38-4d65-8b0b-2f7e33c1f0a1',
      eventName: 'UNKNOWN_TO_SDK_VERSION' as OperationType,
      eventVersion: '1.1',
      eventSource: 'aws:dynamodb',
      awsRegion: 'ddblocal',
      dynamodb: {
        Keys: {
          id: { S: 'expired' }
        },
        OldImage: {
          id: { S: 'expired' },
          expiresAt: { N: '1790724560' }
        },
        SequenceNumber: '000000000000000000003',
        SizeBytes: 33,
        StreamViewType: StreamViewType.NEW_AND_OLD_IMAGES
      }
    };

    const originalSend = DynamoDBStreamsClient.prototype.send;

    let injectRecord = false;

    context.mock.method(DynamoDBStreamsClient.prototype, 'send', function (this: DynamoDBStreamsClient, ...inputs: unknown[]) {
      const [command] = inputs;

      if (injectRecord && command instanceof GetRecordsCommand) {
        injectRecord = false;

        return Promise.resolve({
          Records: [ttlRecord],
          NextShardIterator: command.input.ShardIterator,
          $metadata: {}
        } satisfies GetRecordsCommandOutput);
      }

      return Reflect.apply(originalSend, this, inputs);
    });

    await dropTable(tableName);

    const emulator = await startEmulator(service, options);

    try {
      injectRecord = true;

      ok(await waitUntil(() => changes.length === 1), `expected 1 change, got ${changes.length}`);

      deepEqual(getChange(changes[0].request), {
        type: 'delete',
        record: {
          id: 'expired',
          expiresAt: 1790724560
        }
      });
    } finally {
      await stopEmulator(emulator);
      await dropTable(tableName);
    }
  });

  it('assert :: log a handler error and move on to the next record', async (context) => {
    const service = getDatabaseService('streamsErrorDb', [{ name: 'items', indexes: { id: 'primary' }, stream: true }]);

    const options = getServeOptions(service.name);
    const tableName = getTableName(service.name, 'items', options);

    const errors = context.mock.method(Logger, 'error', () => {});

    const events = observeEvents();

    const changes = observeChanges(({ request }) => {
      if (request.type === StreamChangeType.Insert && request.record.id === 'fail') {
        throw new Error('Stream handler failure.');
      }
    });

    await dropTable(tableName);

    const emulator = await startEmulator(service, options);

    try {
      await putItem(tableName, 'fail');
      await putItem(tableName, 'next');

      ok(await waitUntil(() => changes.length === 2), `expected 2 changes, got ${changes.length}`);

      deepEqual(
        changes.map(({ request }) => getChange(request)),
        [
          {
            type: 'insert',
            record: { id: 'fail' }
          },
          {
            type: 'insert',
            record: { id: 'next' }
          }
        ]
      );

      ok(await waitUntil(() => events.length === 8), `expected 8 listener events, got ${events.length}`);

      deepEqual(getEventTypes(events), ['begin', 'ready', 'error', 'end', 'begin', 'ready', 'done', 'end']);

      const messages = errors.mock.calls.map(({ arguments: [message] }) => `${message}`);

      ok(
        messages.some((message) => message.includes('Stream handler failure.')),
        `expected the handler error to be logged, got ${JSON.stringify(messages)}`
      );
    } finally {
      await stopEmulator(emulator);
      await dropTable(tableName);
    }
  });

  it('assert :: follow the new stream when the table stream is enabled again', async () => {
    const service = getDatabaseService('streamsNewShardDb', [{ name: 'items', indexes: { id: 'primary' }, stream: true }]);

    const options = getServeOptions(service.name);
    const tableName = getTableName(service.name, 'items', options);

    const changes = observeChanges();

    await dropTable(tableName);

    const emulator = await startEmulator(service, options);

    try {
      await putItem(tableName, 'before');

      ok(await waitUntil(() => changes.length === 1), `expected 1 change, got ${changes.length}`);

      await dynamoDb.send(
        new UpdateTableCommand({
          TableName: tableName,
          StreamSpecification: {
            StreamEnabled: false
          }
        })
      );

      await dynamoDb.send(
        new UpdateTableCommand({
          TableName: tableName,
          StreamSpecification: {
            StreamViewType: StreamViewType.NEW_AND_OLD_IMAGES,
            StreamEnabled: true
          }
        })
      );

      await putItem(tableName, 'after');

      ok(await waitUntil(() => changes.length === 2), `expected 2 changes, got ${changes.length}`);

      deepEqual(getChange(changes[1].request), {
        type: 'insert',
        record: { id: 'after' }
      });
    } finally {
      await stopEmulator(emulator);
      await dropTable(tableName);
    }
  });

  it('assert :: stream handler does not run in test mode', async () => {
    const service = getDatabaseService('streamsTestModeDb', [{ name: 'items', indexes: { id: 'primary' }, stream: true }]);

    const options = getServeOptions(service.name, { test: true });
    const tableName = getTableName(service.name, 'items', options);

    const changes = observeChanges();

    await dropTable(tableName);

    const emulator = await startEmulator(service, options);

    try {
      await putItem(tableName, 'foo');

      // Longer than one poll of the stream consumer.
      await setTimeout(1500);

      equal(changes.length, 0);
    } finally {
      await stopEmulator(emulator);
      await dropTable(tableName);
    }
  });
});
