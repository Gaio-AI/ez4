import type { SqlIndexStatement } from '../../statements/index';
import type { SqlFilters } from '../../common/types';

import { escapeSqlName, escapeSqlNames } from '../../utils/escape';
import { SqlConditions } from '../../operations/conditions';

export type SqlIndexOrder = Record<string, 'asc' | 'desc'>;

export class SqlCreateIndexClause {
  #state: {
    index: SqlIndexStatement;
    concurrently?: boolean;
    unique?: boolean;
    nullsNotDistinct?: boolean;
    check: boolean;
    columns: string[];
    include?: string[];
    order?: SqlIndexOrder;
    filters?: SqlConditions;
    table: string;
    type?: string;
  };

  constructor(index: SqlIndexStatement, table: string, columns: string[] = []) {
    this.#state = {
      check: false,
      columns,
      table,
      index
    };
  }

  get conditional() {
    return this.#state.check;
  }

  get concurrently() {
    return this.#state.concurrently;
  }

  missing(check = true) {
    this.#state.check = check;

    return this;
  }

  concurrent(apply = true) {
    this.#state.concurrently = apply;

    return this;
  }

  unique(apply = true) {
    this.#state.unique = apply;

    return this;
  }

  /**
   * A unique index that takes rows with the same columns as duplicates even when they are null.
   */
  nullsNotDistinct(apply = true) {
    this.#state.nullsNotDistinct = apply;

    return this;
  }

  columns(columns: string[]) {
    this.#state.columns = columns;

    return this;
  }

  column(column: string) {
    this.#state.columns.push(column);

    return this;
  }

  /**
   * Sort order of the given index columns (ascending when not given).
   */
  order(order: SqlIndexOrder) {
    this.#state.order = order;

    return this;
  }

  /**
   * Columns stored in the index besides its key, so a query that reads only them needs no table access.
   */
  include(columns: string[]) {
    this.#state.include = columns;

    return this;
  }

  /**
   * Indexes only the rows that match the given filters, which have to be literal values.
   */
  where(filters: SqlFilters) {
    this.#state.filters = new SqlConditions(undefined, undefined, {}, filters);

    return this;
  }

  type(type: string) {
    this.#state.type = type;

    return this;
  }

  build() {
    const { index, table, check, concurrently, unique, nullsNotDistinct, columns, include, order, filters, type } = this.#state;

    const statement = ['CREATE'];

    if (unique) {
      statement.push('UNIQUE');
    }

    statement.push('INDEX');

    if (concurrently) {
      statement.push('CONCURRENTLY');
    }

    if (check) {
      statement.push('IF', 'NOT', 'EXISTS');
    }

    statement.push(escapeSqlName(index.name), 'ON', escapeSqlName(table));

    if (type) {
      statement.push('USING', type);
    }

    const keyColumns = columns.map((column) => {
      return order?.[column] === 'desc' ? `${escapeSqlName(column)} DESC` : escapeSqlName(column);
    });

    statement.push(`(${keyColumns.join(', ')})`);

    if (include?.length) {
      statement.push('INCLUDE', `(${escapeSqlNames(include)})`);
    }

    if (nullsNotDistinct) {
      statement.push('NULLS', 'NOT', 'DISTINCT');
    }

    const conditions = filters?.build();

    if (conditions) {
      statement.push('WHERE', conditions[0]);
    }

    return statement.join(' ');
  }
}
