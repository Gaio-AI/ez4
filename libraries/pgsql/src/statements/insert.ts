import type { ObjectSchema } from '@ez4/schema';
import type { SqlBuilderOptions, SqlBuilderReferences } from '../builder';
import type { SqlResultColumn, SqlResultRecord } from '../common/results';
import type { SqlSourceWithResults } from '../common/source';
import type { SqlTableReference } from '../common/reference';
import type { SqlFilters, SqlRecord } from '../common/types';

import { getFields, getValues } from '../utils/column';
import { escapeSqlName, escapeSqlNames } from '../utils/escape';
import { EmptyRecordError, MissingTableNameError, MultipleRecordsError } from '../errors/statements';
import { InvalidWhereClauseError } from '../errors/clauses';
import { SqlReturningClause } from '../clauses/query/returning';
import { SqlConflictClause } from '../clauses/query/conflict';
import { SqlWhereClause } from '../clauses/query/where';
import { SqlColumnReference } from '../common/reference';
import { getSelectExpressions } from '../helpers/select';
import { SqlSource } from '../common/source';
import { SqlRawValue } from '../common/raw';
import { SqlSelectStatement } from './select';

type SqlInsertContext = {
  options: SqlBuilderOptions;
  references: SqlBuilderReferences;
  variables: unknown[];
};

export class SqlInsertStatement extends SqlSource {
  #state: {
    options: SqlBuilderOptions;
    references: SqlBuilderReferences;
    returning?: SqlReturningClause;
    conflict?: SqlConflictClause;
    sources?: (SqlTableReference | SqlSelectStatement)[];
    where?: SqlWhereClause;
    schema?: ObjectSchema;
    records: SqlRecord[];
    building: boolean;
    table?: string;
    alias?: string;
  };

  constructor(schema: ObjectSchema | undefined, references: SqlBuilderReferences, options: SqlBuilderOptions) {
    super();

    this.#state = {
      building: false,
      records: [],
      references,
      options,
      schema
    };
  }

  get fields() {
    const fields = new Set<string>();

    for (const record of this.#state.records) {
      getFields(record).forEach((field) => fields.add(field));
    }

    return [...fields];
  }

  get values() {
    return this.#state.records.flatMap((record) => getValues(record));
  }

  get filters() {
    return this.#state.where;
  }

  get alias() {
    return this.#state.alias;
  }

  get results() {
    return this.#state.returning?.results;
  }

  get schema() {
    return this.#state.schema;
  }

  get selecting() {
    return !!this.#state.sources;
  }

  get building() {
    return this.#state.building;
  }

  into(table: string) {
    this.#state.table = table;
    return this;
  }

  select(...tables: (SqlTableReference | SqlSelectStatement)[]) {
    this.#state.sources = tables;
    return this;
  }

  as(alias: string | undefined) {
    this.#state.alias = alias;
    return this;
  }

  record(record: SqlRecord) {
    this.#state.records = [record];
    return this;
  }

  records(records: SqlRecord[]) {
    this.#state.records = records;
    return this;
  }

  where(filters?: SqlFilters) {
    const { where, references, options } = this.#state;

    if (!where) {
      this.#state.where = new SqlWhereClause(this, references, options, filters);
    } else if (filters) {
      where.apply(filters);
    }

    return this;
  }

  returning(result?: SqlResultRecord | SqlResultColumn[]) {
    const { references, returning } = this.#state;

    if (!returning) {
      this.#state.returning = new SqlReturningClause(this, references, result);
    } else if (result) {
      returning.apply(result);
    }

    return this as SqlInsertStatement & SqlSourceWithResults;
  }

  /**
   * Set the `ON CONFLICT` clause.
   *
   * @param columns Conflict target, without it any unique violation skips the record.
   * @param record Update applied to the existing record, without it the record is skipped.
   * @param filters Filters the existing record must match to be updated.
   */
  conflict(columns?: string[], record?: SqlRecord, filters?: SqlFilters) {
    const { conflict, schema, references, options } = this.#state;

    if (!conflict) {
      this.#state.conflict = new SqlConflictClause(this, schema, references, options, columns, record, filters);
    } else {
      if (record) {
        conflict.apply(record);
      }

      if (filters) {
        conflict.where(filters);
      }
    }

    return this;
  }

  build(): [string, unknown[]] {
    const { table, alias, references, options, records, schema, sources, where, returning, conflict } = this.#state;

    if (!table) {
      throw new MissingTableNameError();
    }

    try {
      this.#state.building = true;

      const statement = ['INSERT', 'INTO', escapeSqlName(table)];
      const variables: unknown[] = [];

      if (alias) {
        statement.push('AS', escapeSqlName(alias));
      }

      const fields = this.fields;

      // Records without columns insert the default values, which is one row per statement.
      if (records.length > 1 && !fields.length) {
        throw new EmptyRecordError();
      }

      statement.push(fields.length ? `(${escapeSqlNames(fields)})` : 'DEFAULT');

      const context = {
        variables,
        references,
        options
      };

      if (sources) {
        if (records.length > 1) {
          throw new MultipleRecordsError();
        }

        const values = getValueReferences(this, records[0] ?? {}, fields, schema, context);

        const [tableExpressions, tableVariables] = getSelectExpressions(this, references, sources);

        statement.push('SELECT', values);
        variables.push(...tableVariables);

        if (tableExpressions.length) {
          statement.push('FROM', tableExpressions.join(', '));
        }

        if (where && !where.empty) {
          const whereResult = where.build();

          if (whereResult) {
            const [whereClause, whereVariables] = whereResult;

            statement.push(whereClause);
            variables.push(...whereVariables);
          }
        }
      } else {
        statement.push('VALUES');

        if (fields.length) {
          const rows = records.map((record) => `(${getValueReferences(this, record, fields, schema, context)})`);

          statement.push(rows.join(', '));
        }

        if (where) {
          throw new InvalidWhereClauseError();
        }
      }

      if (conflict && !conflict.empty) {
        const [conflictClause, conflictVariables] = conflict.build();

        variables.push(...conflictVariables);
        statement.push(conflictClause);
      }

      if (returning && !returning.empty) {
        const [returningClause, returningVariables] = returning.build();

        variables.push(...returningVariables);
        statement.push(returningClause);
      }

      return [statement.join(' '), variables];
    } finally {
      this.#state.building = false;
    }
  }
}

const getValueReferences = (
  source: SqlSource,
  record: SqlRecord,
  fields: string[],
  schema: ObjectSchema | undefined,
  context: SqlInsertContext
): string => {
  const { variables, references, options } = context;

  const results = [];

  for (const fieldName of fields) {
    const value = record[fieldName];

    // A column another record sets takes its default in this one.
    if (value === undefined) {
      results.push('DEFAULT');
      continue;
    }

    if (value === null) {
      results.push('null');
      continue;
    }

    if (value instanceof SqlColumnReference) {
      results.push(value.build());
      continue;
    }

    if (value instanceof SqlSelectStatement) {
      const [selectStatement, selectVariables] = value.build();

      variables.push(...selectVariables);
      results.push(`(${selectStatement})`);
      continue;
    }

    const fieldValue = value instanceof SqlRawValue ? value.build(source) : value;
    const fieldIndex = references.counter++;

    results.push(`:${fieldIndex}`);

    if (!options.onPrepareVariable) {
      variables.push(fieldValue);
      continue;
    }

    const fieldSchema = schema?.properties[fieldName];

    const preparedValue = options.onPrepareVariable(fieldValue, {
      schema: fieldSchema,
      index: fieldIndex,
      json: false
    });

    variables.push(preparedValue);
  }

  return results.join(', ');
};
