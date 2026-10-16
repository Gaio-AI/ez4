import type { TableIndex } from '@ez4/database/library';
import type { Table as DbTable, Query } from '@ez4/database';
import type { ObjectSchema } from '@ez4/schema';
import type { AnyObject, IsArray } from '@ez4/utils';
import type { PgRelationRepositoryWithSchema } from '../types/repository';
import type { PgClientDriver, PgExecuteStatement, PgExecutionResult } from '../types/driver';
import type { InternalTableMetadata } from '../types/table';
import type { PgAggregateInput } from '../queries/aggregate';

import { DuplicateUniqueKeyError, MissingUniqueIndexError } from '@ez4/pgclient';
import { isAnyNumber } from '@ez4/utils';

import { takeRecordsCursor } from '../queries/utils/cursor';
import { getPrimaryColumns, tryExtractUniqueIndex } from './utils/indexes';

import {
  prepareInsertOne,
  prepareInsertMany,
  prepareFindOne,
  prepareFindMany,
  prepareUpdateOne,
  prepareUpdateMany,
  prepareDeleteMany,
  prepareDeleteOne,
  prepareCount,
  prepareExists,
  prepareAggregate
} from '../queries/queries';

export type TableContext = {
  transactionId?: string;
  driver: PgClientDriver;
  debug?: boolean;
};

type SendStatementResult<T> = IsArray<T> extends true ? PgExecutionResult[] : PgExecutionResult;

export class Table<T extends InternalTableMetadata> implements DbTable<T> {
  constructor(
    private name: string,
    private schema: ObjectSchema,
    private relations: PgRelationRepositoryWithSchema,
    private indexes: TableIndex[],
    private context: TableContext
  ) {}

  private async sendStatement<T extends PgExecuteStatement | PgExecuteStatement[]>(input: T): Promise<SendStatementResult<T>> {
    const { transactionId, driver, debug } = this.context;

    if (!Array.isArray(input)) {
      return driver.executeStatement(input, {
        transactionId,
        debug
      }) as Promise<SendStatementResult<T>>;
    }

    if (!transactionId) {
      return driver.executeTransaction(input, {
        debug
      }) as Promise<SendStatementResult<T>>;
    }

    return driver.executeStatements(input, {
      transactionId,
      debug
    }) as Promise<SendStatementResult<T>>;
  }

  async insertOne<S extends Query.SelectInput<T>>(query: Query.InsertOneInput<S, T>) {
    const statement = await prepareInsertOne(this.name, this.schema, this.relations, this.context.driver, query);

    const { records } = await this.sendStatement(statement);

    return records[0] as Query.InsertOneResult<S, T>;
  }

  private get primaryKey() {
    return getPrimaryColumns(this.indexes);
  }

  async updateOne<S extends Query.SelectInput<T>>(query: Query.UpdateOneInput<S, T>) {
    const statement = await prepareUpdateOne(this.name, this.schema, this.relations, this.context.driver, query, {
      primaryKey: this.primaryKey
    });

    const { records } = await this.sendStatement(statement);

    if (statement.reloadKey) {
      const [record] = await this.findWrittenRecords(statement.reloadKey, records, query);

      return record as Query.UpdateOneResult<S, T>;
    }

    return records[0] as Query.UpdateOneResult<S, T>;
  }

  private async findWrittenRecords<S extends Query.SelectInput<T>>(
    primaryKey: string[],
    records: (AnyObject | undefined)[],
    query: Pick<Query.UpdateOneInput<S, T>, 'select' | 'include'>
  ) {
    const keys = records.filter((record) => !!record);

    if (!keys.length || !query.select) {
      return [];
    }

    const where =
      primaryKey.length === 1
        ? { [primaryKey[0]]: { isIn: keys.map((key) => key[primaryKey[0]]) } }
        : { OR: keys.map((key) => Object.fromEntries(primaryKey.map((column) => [column, key[column]]))) };

    const result = await this.findMany({
      select: query.select,
      include: query.include,
      where: where as Query.WhereInput<T>
    });

    return result.records as AnyObject[];
  }

  async findOne<S extends Query.SelectInput<T>>(query: Query.FindOneInput<S, T>) {
    const statement = prepareFindOne(this.name, this.schema, this.relations, this.context.driver, query);

    const { records } = await this.sendStatement(statement);

    return records[0] as Query.FindOneResult<S, T>;
  }

  async deleteOne<S extends Query.SelectInput<T>>(query: Query.DeleteOneInput<S, T>) {
    const statement = prepareDeleteOne(this.name, this.schema, this.relations, this.context.driver, query);

    const { records } = await this.sendStatement(statement);

    return records[0] as Query.DeleteOneResult<S, T>;
  }

  async upsertOne<S extends Query.SelectInput<T>>(query: Query.UpsertOneInput<S, T>) {
    const uniqueIndex = tryExtractUniqueIndex(this.indexes, query.where);

    if (!uniqueIndex) {
      throw new MissingUniqueIndexError();
    }

    const { driver } = this.context;

    const updateQuery = {
      select: query.select,
      include: query.include,
      previous: query.previous,
      data: query.update,
      where: query.where,
      lock: query.lock
    };

    const updateStatement = await prepareUpdateOne(this.name, this.schema, this.relations, driver, updateQuery, {
      primaryKey: this.primaryKey,
      flag: '__EZ4_OK'
    });

    let hasConflict = false;

    do {
      const { records: updateRecords } = await this.sendStatement(updateStatement);

      const [updateRecord] = updateRecords;

      if (updateRecord?.__EZ4_OK) {
        delete updateRecord.__EZ4_OK;

        const record = updateStatement.reloadKey
          ? (await this.findWrittenRecords(updateStatement.reloadKey, [updateRecord], query))[0]
          : updateRecord;

        return {
          record,
          inserted: false
        } as Query.UpsertOneResult<S, T>;
      }

      try {
        const insertStatement = await prepareInsertOne(this.name, this.schema, this.relations, driver, {
          select: query.select,
          data: query.insert
        });

        const { records: insertRecords } = await this.sendStatement(insertStatement);

        return {
          record: insertRecords[0],
          inserted: true
        } as Query.UpsertOneResult<S, T>;
      } catch (error) {
        // In case of race condition or multiple conflicts, fallback to update retry.
        if (!hasConflict && error instanceof DuplicateUniqueKeyError) {
          hasConflict = true;
          continue;
        }

        throw error;
      }
    } while (true);
  }

  async insertMany(query: Query.InsertManyInput<T>) {
    const statements = await prepareInsertMany<T>(this.name, this.schema, this.relations, this.context.driver, query);

    await this.sendStatement(statements);
  }

  async updateMany<S extends Query.SelectInput<T>>(query: Query.UpdateManyInput<S, T>) {
    const statement = await prepareUpdateMany(this.name, this.schema, this.relations, this.context.driver, query, {
      primaryKey: this.primaryKey
    });

    const { records } = await this.sendStatement(statement);

    if (!query.select) {
      return undefined as Query.UpdateManyResult<S, T>;
    }

    if (statement.reloadKey) {
      return (await this.findWrittenRecords(statement.reloadKey, records, query)) as Query.UpdateManyResult<S, T>;
    }

    return records as Query.UpdateManyResult<S, T>;
  }

  async findMany<S extends Query.SelectInput<T>, C extends boolean = false>(query: Query.FindManyInput<S, C, T>) {
    const { statement: findStatement, cursorFields } = prepareFindMany(this.name, this.schema, this.relations, this.context.driver, query, {
      primaryColumns: this.primaryKey
    });

    const { records } = await this.sendStatement(findStatement);

    const cursor =
      cursorFields && 'take' in query && isAnyNumber(query.take) ? takeRecordsCursor(records, cursorFields, query.take) : undefined;

    if (query.count) {
      // The total counts the filter alone, without the position of the cursor.
      const countStatement = prepareCount(this.name, this.schema, this.relations, this.context.driver, {
        where: query.where
      });

      const { records: count } = await this.sendStatement(countStatement);

      return {
        records,
        total: Number(count?.[0]?.__EZ4_COUNT) || 0,
        ...(cursor && { cursor })
      } as Query.FindManyResult<S, C, T>;
    }

    return {
      records,
      ...(cursor && { cursor })
    } as Query.FindManyResult<S, C, T>;
  }

  async deleteMany<S extends Query.SelectInput<T>>(query: Query.DeleteManyInput<S, T>) {
    const statement = prepareDeleteMany(this.name, this.schema, this.relations, this.context.driver, query, {
      primaryKey: this.primaryKey
    });

    const { records } = await this.sendStatement(statement);

    if (query.select) {
      return records as Query.DeleteManyResult<S, T>;
    }

    return undefined as Query.DeleteManyResult<S, T>;
  }

  async exists(query: Query.ExistsInput<T>) {
    const statement = prepareExists(this.name, this.schema, this.relations, this.context.driver, query);

    const { records } = await this.sendStatement(statement);

    const [result] = records;

    return Number(result?.__EZ4_EXISTS) === 1;
  }

  async count(query: Query.CountInput<T>) {
    const statement = prepareCount(this.name, this.schema, this.relations, this.context.driver, query);

    const { records } = await this.sendStatement(statement);

    const [result] = records;

    return Number(result?.__EZ4_COUNT) || 0;
  }

  async aggregate<B extends Query.AggregateByInput<T> = never, A extends Query.AggregateFieldsInput<T> = {}>(
    query: Query.AggregateInput<B, A, T>
  ) {
    const statement = prepareAggregate(this.name, this.schema, this.relations, this.context.driver, query as PgAggregateInput);

    const { records } = await this.sendStatement(statement);

    return records as Query.AggregateResult<B, A, T>;
  }
}
