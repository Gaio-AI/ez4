import type { DynamoDBDocumentClient, ExecuteStatementCommandInput } from '@aws-sdk/lib-dynamodb';
import type { Table as DbTable, Query } from '@ez4/database';
import type { ObjectSchema } from '@ez4/schema';
import type { AnyObject } from '@ez4/utils';
import type { InternalTableMetadata } from './types';

import { ConditionalCheckFailedException, TransactionCanceledException } from '@aws-sdk/client-dynamodb';

import { getTransformedRecords } from '../client';
import { executeStatement, executeTransaction, logQueryError, TRANSACTION_BATCH_SIZE } from './common/client';
import { isDuplicateItemError } from './utils/errors';
import { UnsupportedAggregateError } from './errors';

import {
  prepareInsertOne,
  prepareInsertMany,
  prepareFindOne,
  prepareFindMany,
  prepareUpdateOne,
  prepareUpdateMany,
  prepareDeleteMany,
  prepareDeleteOne,
  prepareExists,
  prepareCount
} from './common/queries';

const READ_BATCH_SIZE = 25;

export type TableSettings = {
  client: DynamoDBDocumentClient;
  debug?: boolean;
};

export class Table<T extends InternalTableMetadata> implements DbTable<T> {
  constructor(
    private name: string,
    private schema: ObjectSchema,
    private indexes: string[][],
    private settings: TableSettings
  ) {}

  async insertOne<S extends Query.SelectInput<T>>(query: Query.InsertOneInput<S, T>) {
    const { client, debug } = this.settings;

    const statement = await prepareInsertOne(this.name, this.schema, this.indexes, query);

    await executeStatement(client, statement, debug);

    if (query.data) {
      const [firstResult] = getTransformedRecords([query.data], this.schema, query.select);

      return firstResult as Query.InsertOneResult<S, T>;
    }

    return undefined as Query.InsertOneResult<S, T>;
  }

  async updateOne<S extends Query.SelectInput<T>>(query: Query.UpdateOneInput<S, T>) {
    const { client, debug } = this.settings;

    const statement = await prepareUpdateOne(this.name, this.schema, this.indexes, query);

    try {
      const { records } = await executeStatement(client, statement, debug);

      const [firstRecord] = getTransformedRecords(records, this.schema, query.select);

      return firstRecord;
    } catch (error) {
      if (error instanceof ConditionalCheckFailedException) {
        return undefined;
      }

      throw error;
    }
  }

  async findOne<S extends Query.SelectInput<T>>(query: Query.FindOneInput<S, T>) {
    const { client, debug } = this.settings;

    const statement = prepareFindOne(this.name, this.schema, this.indexes, query);

    const { records } = await executeStatement(client, statement, debug);

    const [firstRecord] = getTransformedRecords(records, this.schema, query.select);

    return firstRecord;
  }

  async deleteOne<S extends Query.SelectInput<T>>(query: Query.DeleteOneInput<S, T>) {
    const { client, debug } = this.settings;

    const statement = prepareDeleteOne(this.name, this.schema, query);

    const { records } = await executeStatement(client, statement, debug);

    const [firstRecord] = getTransformedRecords(records, this.schema, query.select);

    return firstRecord;
  }

  async upsertOne<S extends Query.SelectInput<T>>(query: Query.UpsertOneInput<S, T>) {
    // With nothing to write over an existing item, the insert alone answers: a duplicate means the
    // item was already there.
    if (!query.select && !hasUpdateData(query.update)) {
      return {
        inserted: await this.tryInsertOne(query.insert)
      } as Query.UpsertOneResult<S, T>;
    }

    // An existing item takes the update in one request, and only a missing one costs the insert after
    // it. An item another writer inserts in between takes the update again.
    let updated = await this.tryUpdateOne(query);

    if (!updated) {
      if (await this.tryInsertOne(query.insert)) {
        if (query.select) {
          const [record] = getTransformedRecords([query.insert], this.schema, query.select);

          return {
            record,
            inserted: true
          } as Query.UpsertOneResult<S, T>;
        }

        return {
          inserted: true
        } as Query.UpsertOneResult<S, T>;
      }

      updated = await this.tryUpdateOne(query);
    }

    const record = updated?.record;

    return {
      inserted: false,
      ...(record && {
        record
      })
    } as Query.UpsertOneResult<S, T>;
  }

  // Whether the insert wrote the item: `false` when one with its key already exists.
  private async tryInsertOne(data: Query.InsertOneInput<{}, T>['data']) {
    const { client, debug } = this.settings;

    const statement = await prepareInsertOne(this.name, this.schema, this.indexes, { data });

    try {
      await executeStatement(client, statement, debug, isDuplicateItemError);

      return true;
    } catch (error) {
      if (isDuplicateItemError(error)) {
        return false;
      }

      throw error;
    }
  }

  // The upsert's update of an existing item, or `undefined` when no item matches its `where`.
  private async tryUpdateOne<S extends Query.SelectInput<T>>(query: Query.UpsertOneInput<S, T>) {
    const { client, debug } = this.settings;

    const statement = await prepareUpdateOne(this.name, this.schema, this.indexes, {
      where: query.where as Query.WhereInput<T>,
      select: query.select,
      previous: query.previous,
      data: query.update
    });

    try {
      const { records } = await executeStatement(client, statement, debug, isConditionalCheckFailure);

      const [record] = getTransformedRecords(records, this.schema, query.select);

      return { record };
    } catch (error) {
      if (isConditionalCheckFailure(error)) {
        return undefined;
      }

      throw error;
    }
  }

  async insertMany<S extends Query.InsertManySelectInput<T>>(query: Query.InsertManyInput<S, T>) {
    const { client, debug } = this.settings;

    const [transactions, records] = await prepareInsertMany(this.name, this.schema, this.indexes, query);

    let insertedRecords = records;

    if (query.skipDuplicates) {
      insertedRecords = await this.insertSkippingDuplicates(transactions, records);
    } else {
      await executeTransaction(client, transactions, debug);
    }

    if (!query.select) {
      return undefined as Query.InsertManyResult<S, T>;
    }

    // A transaction returns no items, and the items written are the ones sent.
    return getTransformedRecords(insertedRecords, this.schema, query.select) as Query.InsertManyResult<S, T>;
  }

  // A transaction fails whole on an item that already exists, so the failed items that exist are left out and the
  // others are sent again.
  private async insertSkippingDuplicates(transactions: ExecuteStatementCommandInput[], records: AnyObject[]) {
    const { client, debug } = this.settings;

    const insertedRecords: AnyObject[] = [];

    for (let offset = 0; offset < transactions.length; offset += TRANSACTION_BATCH_SIZE) {
      let pending = transactions.slice(offset, offset + TRANSACTION_BATCH_SIZE).map((transaction, index) => {
        return [transaction, records[offset + index]] as const;
      });

      while (pending.length) {
        try {
          await executeTransaction(
            client,
            pending.map(([transaction]) => transaction),
            debug,
            true
          );

          insertedRecords.push(...pending.map(([, record]) => record));
          break;
        } catch (error) {
          const duplicates = await this.getExistingRecords(
            error,
            pending.map(([, record]) => record)
          );

          if (!duplicates.size) {
            pending.forEach(([transaction]) => logQueryError(transaction, true));
            throw error;
          }

          pending = pending.filter((_, index) => !duplicates.has(index));
        }
      }
    }

    return insertedRecords;
  }

  private async getExistingRecords(error: unknown, records: AnyObject[]) {
    if (!(error instanceof TransactionCanceledException) || !error.CancellationReasons) {
      return new Set<number>();
    }

    const failedIndexes = error.CancellationReasons.flatMap(({ Code }, index) => (Code && Code !== 'None' ? [index] : []));

    const [[partitionKey, sortKey]] = this.indexes;

    const existing = await Promise.all(
      failedIndexes.map((index) => {
        const record = records[index];

        return this.findOne({
          select: {
            [partitionKey]: true
          } as Query.StrictSelectInput<Query.SelectInput<T>, T>,
          where: {
            ...(sortKey && { [sortKey]: record[sortKey] }),
            [partitionKey]: record[partitionKey]
          } as Query.WhereInput<T, true>
        });
      })
    );

    return new Set(failedIndexes.filter((_, index) => !!existing[index]));
  }

  async updateMany<S extends Query.SelectInput<T>>(query: Query.UpdateManyInput<S, T>) {
    const { client, debug } = this.settings;

    const [transactions, records] = await prepareUpdateMany(this.name, this.schema, this.indexes, client, query, debug);

    await executeTransaction(client, transactions, debug);

    if (!records) {
      return undefined as Query.UpdateManyResult<S, T>;
    }

    const { select, previous } = query;

    if (!select || previous) {
      return getTransformedRecords(records, this.schema, select) as Query.UpdateManyResult<S, T>;
    }

    // A transaction returns no items, so each record is read again by its key once the write is done, a batch at a
    // time to keep the reads within the table's throughput.
    const [[partitionKey, sortKey]] = this.indexes;

    const currentRecords: AnyObject[] = [];

    for (let offset = 0; offset < records.length; offset += READ_BATCH_SIZE) {
      const batch = await Promise.all(
        records.slice(offset, offset + READ_BATCH_SIZE).map((record: AnyObject) => {
          return this.findOne({
            select,
            where: {
              ...(sortKey && { [sortKey]: record[sortKey] }),
              [partitionKey]: record[partitionKey]
            } as Query.WhereInput<T, true>
          });
        })
      );

      for (const record of batch) {
        if (record) {
          currentRecords.push(record);
        }
      }
    }

    return currentRecords as Query.UpdateManyResult<S, T>;
  }

  async findMany<S extends Query.SelectInput<T>, C extends boolean = false>(query: Query.FindManyInput<S, C, T>) {
    const { client, debug } = this.settings;

    const { count: shouldCount } = query;

    const findStatement = prepareFindMany(this.name, this.schema, this.indexes, query);
    const findOperation = executeStatement(client, findStatement, debug);

    const allOperations = [findOperation];

    if (shouldCount) {
      const countStatement = prepareCount(this.name, this.schema, this.indexes, { where: query.where });
      const countOperation = executeStatement(client, countStatement, debug);

      allOperations.push(countOperation);
    }

    const results = await Promise.all(allOperations);

    const [{ records, cursor }, countResult] = results;

    return {
      ...(shouldCount && { total: countResult?.records.length }),
      records: getTransformedRecords(records, this.schema, query.select),
      cursor
    } as unknown as Query.FindManyResult<S, C, T>;
  }

  async deleteMany<S extends Query.SelectInput<T>>(query: Query.DeleteManyInput<S, T>) {
    const { client, debug } = this.settings;

    const [transactions, records] = await prepareDeleteMany(this.name, this.schema, this.indexes, client, query, debug);

    await executeTransaction(client, transactions, debug);

    if (records) {
      return getTransformedRecords(records, this.schema, query.select) as Query.DeleteManyResult<S, T>;
    }

    return undefined as Query.DeleteManyResult<S, T>;
  }

  async exists(query: Query.ExistsInput<T>) {
    const { client, debug } = this.settings;

    const statement = prepareExists(this.name, this.schema, this.indexes, query);

    const { records } = await executeStatement(client, statement, debug);

    const [firstRecord] = records;

    return !!firstRecord;
  }

  async count(query: Query.CountInput<T>) {
    const { client, debug } = this.settings;

    const statement = prepareCount(this.name, this.schema, this.indexes, query);

    const { records } = await executeStatement(client, statement, debug);

    return records.length;
  }

  aggregate(_query: never): Promise<never> {
    return Promise.reject(new UnsupportedAggregateError());
  }
}

const hasUpdateData = (data: AnyObject) => {
  return Object.values(data).some((value) => value !== undefined);
};

const isConditionalCheckFailure = (error: unknown) => {
  return error instanceof ConditionalCheckFailedException;
};
