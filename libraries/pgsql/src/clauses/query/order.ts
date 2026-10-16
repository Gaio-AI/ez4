import type { SqlSource } from '../../common/source';
import type { SqlOrder } from '../../common/types';

import { isEmptyObject } from '@ez4/utils';
import { Order } from '@ez4/database';

import { mergeSqlAlias } from '../../utils/merge';
import { escapeSqlName } from '../../utils/escape';
import { InvalidColumnOrderError } from '../../errors/clauses';
import { SqlAggregateColumn } from '../../common/aggregate';

export class SqlOrderClause {
  #state: {
    source: SqlSource;
    columns: SqlOrder;
  };

  constructor(source: SqlSource, columns: SqlOrder = {}) {
    this.#state = {
      source,
      columns
    };
  }

  get empty() {
    return isEmptyObject(this.#state.columns);
  }

  apply(columns: SqlOrder) {
    this.#state.columns = columns;

    return this;
  }

  build() {
    const { source, columns } = this.#state;

    const orderColumns = [];

    for (const column in columns) {
      const order = columns[column];

      if (order) {
        const alias = isAggregateColumn(source, column) ? undefined : source.alias;

        orderColumns.push(getOrderColumn(column, order, alias));
      }
    }

    return `ORDER BY ${orderColumns.join(', ')}`;
  }
}

// An aggregate exists only as an output column, which a table alias can't qualify.
const isAggregateColumn = (source: SqlSource, column: string) => {
  return !!source.results?.fields.some((field) => field instanceof SqlAggregateColumn && field.alias === column);
};

const getOrderColumn = (column: string, order: Order, alias?: string) => {
  const columnName = mergeSqlAlias(escapeSqlName(column), alias);

  switch (order) {
    case Order.Asc:
      return `${columnName} ASC`;

    case Order.Desc:
      return `${columnName} DESC`;

    default:
      throw new InvalidColumnOrderError(column);
  }
};
