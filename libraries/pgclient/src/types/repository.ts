import type { TableIndex, TableRelation, TableRenames, TableTimestamps } from '@ez4/database/library';
import type { ObjectSchema } from '@ez4/schema';
import type { AnyObject } from '@ez4/utils';

import { isObjectWith } from '@ez4/utils';

export type PgTableRepository = Record<string, PgTableMetadata>;

export type PgTableMetadata = {
  name: string;
  renamedFrom?: TableRenames;
  timestamps?: TableTimestamps;
  relations: PgRelationRepository;
  indexes: PgIndexRepository;
  schema: ObjectSchema;
};

export type PgRelationRepository = Record<string, PgRelationMetadata>;

export type PgRelationMetadata = Omit<TableRelation, 'targetAlias'>;

export type PgRelationRepositoryWithSchema = Record<string, PgRelationWithSchema>;

export type PgRelationWithSchema = TableRelation & {
  primaryColumn: string;

  /**
   * Schema of the related table, as it inserts records.
   */
  sourceSchema: ObjectSchema;

  /**
   * Timestamps of the related table, which an update of its records leaves out.
   */
  sourceTimestamps?: TableTimestamps;

  targetTable: string;
};

export type PgTableIndex = TableIndex;

export type PgIndexRepository = Record<string, PgTableIndex>;

export const isTableMetadata = (input: AnyObject): input is PgTableMetadata => {
  return isObjectWith(input, ['name', 'indexes', 'relations', 'schema']);
};

export const isTableIndex = (input: AnyObject): input is PgTableIndex => {
  return isObjectWith(input, ['name', 'columns', 'type']);
};
