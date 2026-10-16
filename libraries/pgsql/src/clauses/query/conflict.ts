import type { ObjectSchema } from '@ez4/schema';
import type { SqlSource } from '../../common/source';
import type { SqlFilters, SqlRecord } from '../../common/types';
import type { SqlBuilderOptions, SqlBuilderReferences } from '../../builder';

import { getUpdateColumns } from '../../helpers/update';
import { MissingConflictTargetError } from '../../errors/clauses';
import { escapeSqlNames } from '../../utils/escape';
import { SqlWhereClause } from './where';

export class SqlConflictClause {
  #state: {
    source: SqlSource;
    schema?: ObjectSchema;
    references: SqlBuilderReferences;
    options: SqlBuilderOptions;
    columns?: string[];
    record?: SqlRecord;
    where?: SqlWhereClause;
  };

  constructor(
    source: SqlSource,
    schema: ObjectSchema | undefined,
    references: SqlBuilderReferences,
    options: SqlBuilderOptions,
    columns?: string[],
    record?: SqlRecord,
    filters?: SqlFilters
  ) {
    this.#state = {
      source,
      schema,
      references,
      options,
      columns,
      record
    };

    if (filters) {
      this.where(filters);
    }
  }

  get empty() {
    return !!this.#state.columns && !this.#state.columns.length;
  }

  apply(record: SqlRecord) {
    this.#state.record = record;

    return this;
  }

  columns(...columns: string[]) {
    this.#state.columns = columns;

    return this;
  }

  column(column: string) {
    (this.#state.columns ??= []).push(column);

    return this;
  }

  where(filters: SqlFilters) {
    const { source, references, options, where } = this.#state;

    if (!where) {
      this.#state.where = new SqlWhereClause(source, references, options, filters);
    } else {
      where.apply(filters);
    }

    return this;
  }

  build(): [string, unknown[]] {
    const { references, options, schema, source, columns, record, where } = this.#state;

    // Without columns any unique violation is the conflict, which can only be skipped.
    const clause = [columns ? `ON CONFLICT (${escapeSqlNames(columns)}) DO` : 'ON CONFLICT DO'];
    const variables: unknown[] = [];

    const context = { variables, references, options };

    const updateColumns = record && getUpdateColumns(source, record, schema, context);

    if (!updateColumns?.length) {
      clause.push('NOTHING');

      return [clause.join(' '), variables];
    }

    if (!columns) {
      throw new MissingConflictTargetError();
    }

    clause.push(`UPDATE SET ${updateColumns.join(', ')}`);

    const whereResult = where && !where.empty && where.build();

    if (whereResult) {
      const [whereClause, whereVariables] = whereResult;

      clause.push(whereClause);
      variables.push(...whereVariables);
    }

    return [clause.join(' '), variables];
  }
}
