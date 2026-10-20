import type { ArrayRest, IsArrayEmpty } from '@ez4/utils';
import type { DatabaseTable, DatabaseTables } from './table';
import type { TableSchema } from './schemas';
import type { Database } from './contract';
import type { Index } from '../types';

/**
 * Database table indexes.
 */
export type TableIndexes = {};

/**
 * Given an index name `T`, it produces the decomposed index names.
 */
export type DecomposeIndexName<T> = T extends `${infer L}:${infer R}` ? L | DecomposeIndexName<R> : T;

/**
 * Given an index declaration `V`, either its type or an object with its type and options, it produces
 * the index type.
 */
export type IndexType<V> = V extends { type: infer T } ? T : V;

/**
 * Given an index name `P` and its declaration `V`, it produces the index columns: the ones the
 * declaration lists, or the ones in its name.
 */
export type IndexColumns<P, V> = V extends { columns: infer C extends string[] } ? C[number] : DecomposeIndexName<P>;

/**
 * Given an index object `T`, it produces the columns of all its indexes.
 */
export type DecomposeIndexColumns<T extends TableIndexes> = {
  [P in keyof T]: IndexColumns<P, T[P]>;
}[keyof T];

/**
 * Given an index object `T`, it produces an object containing only primary indexes.
 */
export type PrimaryIndexes<T extends TableIndexes> = {
  [P in keyof T as Index.Primary extends IndexType<T[P]> ? P : never]: T[P];
};

/**
 * Given an index object `T`, it produces an object containing only unique indexes. A partial unique
 * index (one with `where`) is left out: it doesn't identify a record by its columns alone.
 */
export type UniqueIndexes<T extends TableIndexes> = {
  [P in keyof T as Index.Unique extends IndexType<T[P]> ? (T[P] extends { where: {} } ? never : P) : never]: T[P];
};

/**
 * Given an index object `T`, it produces an object containing only secondary indexes.
 */
export type SecondaryIndexes<T extends TableIndexes> = {
  [P in keyof T as Index.Secondary | Index.TTL extends IndexType<T[P]> ? P : never]: T[P];
};

/**
 * Given an index object `T`, it produces the primary decomposed index names.
 */
export type DecomposePrimaryIndexNames<T extends TableIndexes> = DecomposeIndexColumns<PrimaryIndexes<T>>;

/**
 * Given an index object `T`, it produces the unique decomposed index names.
 */
export type DecomposeUniqueIndexNames<T extends TableIndexes> = DecomposeIndexColumns<UniqueIndexes<T>>;

/**
 * Given an index object `T`, it produces the secondary decomposed index names.
 */
export type DecomposeSecondaryIndexNames<T extends TableIndexes> = DecomposeIndexColumns<SecondaryIndexes<T>>;

/**
 * Given a database service `T`, it produces an object with all tables containing indexes.
 */
export type IndexedTables<T extends Database.Service<any>> = MergeIndexes<DatabaseTables<T>>;

/**
 * Given a list of tables with indexes `T`, it produces another object containing all the
 * table indexes.
 */
type MergeIndexes<T extends DatabaseTable<TableSchema, any>[], A = {}> =
  IsArrayEmpty<T> extends false ? MergeIndexes<ArrayRest<T>, A & ExtractIndexes<T[0]>> : A;

/**
 * Given a database table `T`, it produces an object containing all the table indexes.
 */
type ExtractIndexes<T> = T extends { name: infer N; indexes: infer I }
  ? N extends string
    ? I extends TableIndexes
      ? { [P in N]: I }
      : {}
    : {}
  : {};
