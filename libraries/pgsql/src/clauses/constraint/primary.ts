import type { SqlConstraintClause } from './clause';

import { escapeSqlName, escapeSqlNames } from '../../utils/escape';

export class SqlPrimaryKeyConstraintClause {
  #state: {
    constraint: SqlConstraintClause;
    columns: string[];
    index?: string;
  };

  constructor(constraint: SqlConstraintClause, columns: string[]) {
    this.#state = {
      columns,
      constraint
    };
  }

  get name() {
    return this.#state.constraint.name;
  }

  columns(columns: string[]) {
    this.#state.columns = columns;

    return this;
  }

  /**
   * Turn an existing unique index into the primary key instead of building a new one, which
   * happens under a lock that blocks writes to the table for the whole build.
   */
  index(name: string) {
    this.#state.index = name;

    return this;
  }

  build() {
    const { constraint, columns, index } = this.#state;

    if (!constraint.building) {
      return constraint.build();
    }

    const clause = ['ADD CONSTRAINT', escapeSqlName(constraint.name), 'PRIMARY KEY'];

    if (index) {
      clause.push('USING INDEX', escapeSqlName(index));
    } else {
      clause.push(`(${escapeSqlNames(columns)})`);
    }

    return clause.join(' ');
  }
}
