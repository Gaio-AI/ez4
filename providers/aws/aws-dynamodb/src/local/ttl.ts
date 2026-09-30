import type { AttributeValue, DynamoDBClient } from '@aws-sdk/client-dynamodb';
import type { LocalWorker } from './workers';

import { ConditionalCheckFailedException, DeleteItemCommand, ScanCommand } from '@aws-sdk/client-dynamodb';
import { Logger } from '@ez4/logger';

export type TimeToLiveSweeperRequest = {
  client: DynamoDBClient;
  tableName: string;
  ttlAttribute: string;
  keyAttributes: string[];
  interval: number;
};

type ItemKey = Record<string, AttributeValue>;

type SweeperState = {
  stopped: boolean;
};

// Production deletes an expired item within up to 48 hours after its expiration, the sweeper doesn't
// reproduce that delay: every sweep deletes all the items expired by then.
export const startTimeToLiveSweeper = (request: TimeToLiveSweeperRequest): LocalWorker => {
  const state: SweeperState = {
    stopped: false
  };

  let sweepTask: Promise<void> | undefined;

  const sweepTimer = setInterval(() => {
    sweepTask ??= sweepExpiredItems(request, state)
      .catch((error) => {
        Logger.error(`TTL sweep of table [${request.tableName}] failed: ${error}`);
      })
      .finally(() => {
        sweepTask = undefined;
      });
  }, request.interval * 1000);

  return {
    stop: async () => {
      state.stopped = true;

      clearInterval(sweepTimer);

      await sweepTask;
    }
  };
};

const sweepExpiredItems = async (request: TimeToLiveSweeperRequest, state: SweeperState) => {
  const { client, tableName, ttlAttribute, keyAttributes } = request;

  const expiresAt = `${Math.floor(Date.now() / 1000)}`;

  const keyNames = Object.fromEntries(keyAttributes.map((attributeName, index) => [`#key${index}`, attributeName]));

  let lastKey: ItemKey | undefined;

  do {
    const { Items = [], LastEvaluatedKey } = await client.send(
      new ScanCommand({
        TableName: tableName,
        ConsistentRead: true,
        ExclusiveStartKey: lastKey,
        ProjectionExpression: Object.keys(keyNames).join(', '),
        FilterExpression: '#ttl <= :expiresAt',
        ExpressionAttributeNames: {
          ...keyNames,
          '#ttl': ttlAttribute
        },
        ExpressionAttributeValues: {
          ':expiresAt': { N: expiresAt }
        }
      })
    );

    for (const itemKey of Items) {
      if (state.stopped) {
        return;
      }

      await deleteExpiredItem(request, itemKey, expiresAt);
    }

    lastKey = LastEvaluatedKey;
  } while (lastKey && !state.stopped);
};

const deleteExpiredItem = async (request: TimeToLiveSweeperRequest, itemKey: ItemKey, expiresAt: string) => {
  try {
    await request.client.send(
      new DeleteItemCommand({
        TableName: request.tableName,
        Key: itemKey,
        // An item that got a later expiration since the scan stays.
        ConditionExpression: '#ttl <= :expiresAt',
        ExpressionAttributeNames: {
          '#ttl': request.ttlAttribute
        },
        ExpressionAttributeValues: {
          ':expiresAt': { N: expiresAt }
        }
      })
    );
  } catch (error) {
    if (!(error instanceof ConditionalCheckFailedException)) {
      throw error;
    }
  }
};
