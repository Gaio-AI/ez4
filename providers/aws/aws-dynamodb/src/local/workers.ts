import type { EmulateServiceContext, ServeOptions } from '@ez4/project/library';
import type { DatabaseService } from '@ez4/database/library';

import { DynamoDBStreamsClient } from '@aws-sdk/client-dynamodb-streams';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { getServiceName } from '@ez4/project/library';
import { Logger } from '@ez4/logger';

import { getAttributeSchema } from '../utils/schema';
import { getTableName } from '../utils/table';
import { getConnectionOptions, getTimeToLiveOptions } from './options';
import { startStreamConsumer } from './stream';
import { startTimeToLiveSweeper } from './ttl';
import { processStreamRecord } from './handler';

export type LocalWorker = {
  stop: () => Promise<void>;
};

type LocalWorkers = {
  workers: LocalWorker[];
  clients: (DynamoDBClient | DynamoDBStreamsClient)[];
};

const ALL_WORKERS: Record<string, LocalWorkers> = {};
const ALL_TASKS: Record<string, Promise<void>> = {};

// Tasks of the same service run one after the other, so starts and stops from overlapping
// reloads never leave two sets of workers behind.
export const runServiceTask = (serviceName: string, task: () => Promise<void>) => {
  const currentTask = (ALL_TASKS[serviceName] ?? Promise.resolve()).then(task);

  ALL_TASKS[serviceName] = currentTask.catch(() => {});

  return currentTask;
};

export const startLocalWorkers = async (service: DatabaseService, options: ServeOptions, context: EmulateServiceContext) => {
  const ttlOptions = getTimeToLiveOptions(service, options);

  const serviceName = getServiceName(service, options);

  const workerTables = service.tables.filter((table) => {
    const { ttlAttribute } = getAttributeSchema(table.indexes, table.schema);

    return table.stream || (ttlAttribute && ttlOptions.enabled);
  });

  if (!workerTables.length) {
    return;
  }

  const { endpoint } = getConnectionOptions(service, options);

  const client = new DynamoDBClient({ endpoint });
  const streamsClient = new DynamoDBStreamsClient({ endpoint });

  const localWorkers: LocalWorkers = {
    clients: [client, streamsClient],
    workers: []
  };

  ALL_WORKERS[serviceName] = localWorkers;

  try {
    for (const table of workerTables) {
      const { attributeSchema, ttlAttribute } = getAttributeSchema(table.indexes, table.schema);

      const tableName = getTableName(serviceName, table);
      const tableStream = table.stream;

      if (tableStream) {
        const handlerContext = {
          stream: tableStream,
          service,
          options,
          context,
          table
        };

        const consumer = await startStreamConsumer({
          onRecord: (record) => processStreamRecord(handlerContext, record),
          streamsClient,
          tableName,
          client
        });

        localWorkers.workers.push(consumer);

        Logger.log(`🔁 Stream handler of table [${tableName}] is listening`);
      }

      if (ttlAttribute && ttlOptions.enabled) {
        const [primarySchema] = attributeSchema;

        const sweeper = startTimeToLiveSweeper({
          keyAttributes: primarySchema.map(({ attributeName }) => attributeName),
          interval: ttlOptions.interval,
          ttlAttribute,
          tableName,
          client
        });

        localWorkers.workers.push(sweeper);

        Logger.log(`⌛ TTL sweeper of table [${tableName}] runs every ${ttlOptions.interval}s`);
      }
    }
  } catch (error) {
    await stopLocalWorkers(serviceName);
    throw error;
  }
};

export const stopLocalWorkers = async (serviceName: string) => {
  const localWorkers = ALL_WORKERS[serviceName];

  if (!localWorkers) {
    return;
  }

  delete ALL_WORKERS[serviceName];

  await Promise.all(localWorkers.workers.map((worker) => worker.stop()));

  localWorkers.clients.forEach((client) => client.destroy());

  Logger.log(`⛔ Stopped stream handlers and TTL sweepers of [${serviceName}]`);
};
