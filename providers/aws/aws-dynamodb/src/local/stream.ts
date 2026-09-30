import type { _Record, DynamoDBStreamsClient, Shard } from '@aws-sdk/client-dynamodb-streams';
import type { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import type { LocalWorker } from './workers';

import { DescribeTableCommand, ResourceNotFoundException } from '@aws-sdk/client-dynamodb';
import { Logger } from '@ez4/logger';

import {
  DescribeStreamCommand,
  GetRecordsCommand,
  GetShardIteratorCommand,
  ExpiredIteratorException,
  TrimmedDataAccessException,
  ResourceNotFoundException as StreamNotFoundException,
  ShardIteratorType
} from '@aws-sdk/client-dynamodb-streams';

export type StreamConsumerRequest = {
  client: DynamoDBClient;
  streamsClient: DynamoDBStreamsClient;
  tableName: string;
  onRecord: (record: _Record) => Promise<void>;
};

type ShardCursor = {
  streamArn: string;
  shardId: string;
  iteratorType: ShardIteratorType;
  sequenceNumber?: string;
  iterator?: string;
};

type ShardRecords = {
  records: _Record[];
  closed: boolean;
};

type ConsumerState = {
  openShards: Map<string, ShardCursor>;
  knownShards: Set<string>;
  discover: boolean;
  stopped: boolean;
  failing: boolean;
};

const POLL_INTERVAL = 1000;

export const startStreamConsumer = async (request: StreamConsumerRequest): Promise<LocalWorker> => {
  const state: ConsumerState = {
    openShards: new Map(),
    knownShards: new Set(),
    discover: false,
    stopped: false,
    failing: false
  };

  // Like the production event source mapping, the consumer starts from the tip of the stream.
  await discoverShards(request, state, ShardIteratorType.LATEST);

  let pollTimer: NodeJS.Timeout | undefined;
  let pollTask: Promise<void> | undefined;

  const schedulePoll = () => {
    pollTimer = setTimeout(() => {
      pollTask = pollStream(request, state).finally(() => {
        pollTask = undefined;

        if (!state.stopped) {
          schedulePoll();
        }
      });
    }, POLL_INTERVAL);
  };

  schedulePoll();

  return {
    stop: async () => {
      state.stopped = true;

      clearTimeout(pollTimer);

      await pollTask;
    }
  };
};

const pollStream = async (request: StreamConsumerRequest, state: ConsumerState) => {
  try {
    // New shards come after a closed shard or with a new stream of the table.
    if (state.discover || !state.openShards.size) {
      await discoverShards(request, state, ShardIteratorType.TRIM_HORIZON);

      state.discover = false;
    }

    for (const cursor of [...state.openShards.values()]) {
      if (state.stopped) {
        return;
      }

      await pollShard(request, state, cursor);
    }

    state.failing = false;
  } catch (error) {
    if (!state.failing) {
      Logger.error(`Stream of table [${request.tableName}] can't be read: ${error}`);
    }

    state.discover = true;
    state.failing = true;
  }
};

const pollShard = async (request: StreamConsumerRequest, state: ConsumerState, cursor: ShardCursor) => {
  const { records, closed } = await getShardRecords(request, cursor);

  // Records of a shard run in order and a failed record isn't retried, like the production stream function.
  for (const record of records) {
    if (state.stopped) {
      return;
    }

    try {
      await request.onRecord(record);
    } catch (error) {
      Logger.error(`Stream record of table [${request.tableName}] failed: ${error}`);
    }

    cursor.sequenceNumber = record.dynamodb?.SequenceNumber ?? cursor.sequenceNumber;
  }

  if (closed) {
    state.openShards.delete(cursor.shardId);
    state.discover = true;
  }
};

const getShardRecords = async (request: StreamConsumerRequest, cursor: ShardCursor): Promise<ShardRecords> => {
  try {
    cursor.iterator ??= await getShardIterator(request, cursor);

    if (!cursor.iterator) {
      return {
        records: [],
        closed: true
      };
    }

    const { Records = [], NextShardIterator } = await request.streamsClient.send(
      new GetRecordsCommand({
        ShardIterator: cursor.iterator
      })
    );

    cursor.iterator = NextShardIterator;

    return {
      records: Records,
      closed: !NextShardIterator
    };
  } catch (error) {
    if (error instanceof StreamNotFoundException) {
      return {
        records: [],
        closed: true
      };
    }

    // The next poll takes a new iterator after the last record read, or from the oldest record kept
    // when the records after it were trimmed.
    if (error instanceof TrimmedDataAccessException) {
      cursor.iteratorType = ShardIteratorType.TRIM_HORIZON;
      cursor.sequenceNumber = undefined;
    } else if (!(error instanceof ExpiredIteratorException)) {
      throw error;
    }

    cursor.iterator = undefined;

    return {
      records: [],
      closed: false
    };
  }
};

const getShardIterator = async (request: StreamConsumerRequest, cursor: ShardCursor) => {
  const { streamArn, shardId, sequenceNumber, iteratorType } = cursor;

  const { ShardIterator } = await request.streamsClient.send(
    new GetShardIteratorCommand({
      StreamArn: streamArn,
      ShardId: shardId,
      ...(sequenceNumber
        ? {
            ShardIteratorType: ShardIteratorType.AFTER_SEQUENCE_NUMBER,
            SequenceNumber: sequenceNumber
          }
        : {
            ShardIteratorType: iteratorType
          })
    })
  );

  return ShardIterator;
};

const discoverShards = async (request: StreamConsumerRequest, state: ConsumerState, iteratorType: ShardIteratorType) => {
  const streamArn = await getStreamArn(request);

  if (!streamArn) {
    return;
  }

  for (const shard of await getAllShards(request, streamArn)) {
    const { ShardId: shardId, ParentShardId: parentShardId, SequenceNumberRange } = shard;

    if (!shardId || state.knownShards.has(shardId)) {
      continue;
    }

    // Changes of a child shard come after the ones of its parent, so the parent is read to its end first.
    if (parentShardId && state.openShards.has(parentShardId)) {
      continue;
    }

    // At the start, a closed shard only holds changes made before it.
    if (iteratorType === ShardIteratorType.LATEST && SequenceNumberRange?.EndingSequenceNumber) {
      state.knownShards.add(shardId);
      continue;
    }

    const cursor: ShardCursor = {
      streamArn,
      shardId,
      iteratorType
    };

    // A LATEST iterator marks the tip at the moment it's taken, so it's taken right away.
    cursor.iterator = await getShardIterator(request, cursor);

    state.knownShards.add(shardId);
    state.openShards.set(shardId, cursor);
  }
};

const getStreamArn = async (request: StreamConsumerRequest) => {
  try {
    const { Table } = await request.client.send(
      new DescribeTableCommand({
        TableName: request.tableName
      })
    );

    return Table?.LatestStreamArn;
  } catch (error) {
    if (!(error instanceof ResourceNotFoundException)) {
      throw error;
    }

    return undefined;
  }
};

const getAllShards = async (request: StreamConsumerRequest, streamArn: string) => {
  const allShards: Shard[] = [];

  let lastShardId: string | undefined;

  try {
    do {
      const { StreamDescription } = await request.streamsClient.send(
        new DescribeStreamCommand({
          StreamArn: streamArn,
          ExclusiveStartShardId: lastShardId
        })
      );

      allShards.push(...(StreamDescription?.Shards ?? []));

      lastShardId = StreamDescription?.LastEvaluatedShardId;
    } while (lastShardId);
  } catch (error) {
    if (!(error instanceof StreamNotFoundException)) {
      throw error;
    }
  }

  return allShards;
};
