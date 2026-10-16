import type { SqlBuilderOptions, SqlBuilderReferences } from '../builder';
import type { SqlSource } from './source';
import type { SqlFilters } from './types';

import { SqlConditions } from '../operations/conditions';
import { mergeSqlAlias } from '../utils/merge';
import { escapeSqlName } from '../utils/escape';

export type SqlAggregateFunction = 'count' | 'sum' | 'min' | 'max';

export type SqlAggregateColumnOptions = {
  /**
   * Aggregate function.
   */
  function: SqlAggregateFunction;

  /**
   * Aggregated column, all the records when it's not given.
   */
  column?: string;

  /**
   * Determines whether only the distinct column values are aggregated.
   */
  distinct?: boolean;

  /**
   * Filters of the aggregated records (`FILTER` clause).
   */
  filters?: SqlFilters;

  /**
   * Wrap the aggregate expression, such as to format its result.
   */
  format?: (expression: string) => string;

  /**
   * Result column alias.
   */
  alias?: string;
};

export class SqlAggregateColumn {
  #state: {
    source: SqlSource;
    references: SqlBuilderReferences;
    options: SqlBuilderOptions;
    aggregate: SqlAggregateColumnOptions;
  };

  constructor(source: SqlSource, references: SqlBuilderReferences, options: SqlBuilderOptions, aggregate: SqlAggregateColumnOptions) {
    this.#state = {
      source,
      references,
      options,
      aggregate
    };
  }

  get alias() {
    return this.#state.aggregate.alias;
  }

  build(): [string, unknown[]] {
    const { source, references, options, aggregate } = this.#state;
    const { column, distinct, filters, format, alias } = aggregate;

    const columnName = column ? mergeSqlAlias(escapeSqlName(column), source.alias) : '*';
    const variables: unknown[] = [];

    let expression = `${aggregate.function.toUpperCase()}(${distinct ? `DISTINCT ${columnName}` : columnName})`;

    if (filters) {
      const filterResult = new SqlConditions(source, references, options, filters).build();

      if (filterResult) {
        const [filterClause, filterVariables] = filterResult;

        expression = `${expression} FILTER (WHERE ${filterClause})`;
        variables.push(...filterVariables);
      }
    }

    if (format) {
      expression = format(expression);
    }

    if (alias) {
      return [`${expression} AS ${escapeSqlName(alias)}`, variables];
    }

    return [expression, variables];
  }
}
