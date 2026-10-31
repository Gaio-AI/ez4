import type { AnyObject, ArrayRest, IsArrayEmpty, IsObjectEmpty, PropertyExists, PropertyType } from '@ez4/utils';
import type { DatabaseTable, DatabaseTables, TableMetadata } from './table';
import type { TableSchema } from './schemas';
import type { Database } from './contract';

/**
 * Timestamps a table declares, as its metadata keeps them.
 */
export type TableTimestampsMetadata = {
  created?: string;
  updated?: string;
};

/**
 * Given a database service `T`, it produces an object with the timestamps of each table that declares them.
 */
export type TimestampTables<T extends Database.Service<any>> = MergeTimestamps<DatabaseTables<T>>;

/**
 * Given a list of tables `T`, it produces an object with the timestamps of each table that declares them.
 */
export type MergeTimestamps<T extends DatabaseTable<TableSchema, any>[], A = {}> =
  IsArrayEmpty<T> extends false ? MergeTimestamps<ArrayRest<T>, A & ExtractTimestamps<T[0]>> : A;

/**
 * Given a table name `P` and the timestamps of each table `T`, it produces the timestamps of the table.
 */
export type TableTimestamp<P, T extends AnyObject> =
  PropertyExists<P, T> extends true ? (T[P] extends TableTimestampsMetadata ? T[P] : {}) : {};

/**
 * Given the schemas `S` and the timestamps `M` of each table, it produces the schema each table inserts with.
 */
export type InsertSchemas<S extends Record<string, TableSchema>, M extends AnyObject> =
  IsObjectEmpty<M> extends true ? S : { [P in keyof S]: TimestampsModeUtils.InsertSchema<S[P], TimestampColumns<PropertyType<P, M>>> };

/**
 * Given the schemas `S` and the timestamps `M` of each table, it produces the schema each table updates with.
 */
export type UpdateSchemas<S extends Record<string, TableSchema>, M extends AnyObject> =
  IsObjectEmpty<M> extends true ? S : { [P in keyof S]: TimestampsModeUtils.UpdateSchema<S[P], TimestampColumns<PropertyType<P, M>>> };

/**
 * Timestamps mode utils.
 */
export namespace TimestampsModeUtils {
  /**
   * Columns the database writes for the table: its creation and update timestamps.
   */
  export type Columns<T extends TableMetadata> = T extends { timestamps: infer M } ? TimestampColumns<M> : never;

  /**
   * Column the database writes on every update of the table.
   */
  export type Updated<T extends TableMetadata> = T extends { timestamps: { updated: infer U extends string } } ? U : never;

  /**
   * Schema `S` of an insert, where the database writes the timestamp columns `K` left out.
   */
  export type InsertSchema<S extends AnyObject, K extends string> = [K] extends [never] ? S : Omit<S, K> & Partial<Pick<S, K & keyof S>>;

  /**
   * Schema `S` of an update, without the timestamp columns `K`: the database writes the update timestamp and
   * keeps the creation one.
   */
  export type UpdateSchema<S extends AnyObject, K extends string> = [K] extends [never] ? S : Omit<S, K>;

  /**
   * Touch input type based on the table metadata: only a table with an update timestamp takes it.
   */
  export type TouchInput<T extends TableMetadata> = [Updated<T>] extends [never] ? never : true;
}

type ExtractTimestamps<T> = T extends { name: infer N; timestamps: infer M } ? (N extends string ? { [P in N]: M } : {}) : {};

type TimestampColumns<M> =
  | (M extends { created: infer C extends string } ? C : never)
  | (M extends { updated: infer U extends string } ? U : never);
