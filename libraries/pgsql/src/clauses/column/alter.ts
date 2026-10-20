import type { SqlAlterTableClause } from '../table/alter';

import { escapeSqlName } from '../../utils/escape';
import { MissingClauseError } from '../../errors/clauses';

export class SqlAlterColumnClause {
  #state: {
    table: SqlAlterTableClause;
    name: string;
    required?: boolean;
    value?: string | null;
    type?: string;
    cast?: boolean;
  };

  constructor(table: SqlAlterTableClause, name: string) {
    this.#state = {
      table,
      name
    };
  }

  get nullable() {
    return !this.#state.required;
  }

  get name() {
    return this.#state.name;
  }

  get empty() {
    return !this.#state.type && this.#state.value === undefined && this.#state.required === undefined;
  }

  type(type?: string, cast = true) {
    this.#state.type = type;
    this.#state.cast = cast;
    return this;
  }

  required(apply = true) {
    this.#state.required = apply;
    return this;
  }

  optional(apply = true) {
    this.#state.required = !apply;
    return this;
  }

  default(value?: string | null) {
    this.#state.value = value;
    return this;
  }

  build() {
    const { table, name, type, cast, required, value } = this.#state;

    if (!table.building) {
      return table.build();
    }

    const columnName = escapeSqlName(name);

    const base = ['ALTER COLUMN', columnName];
    const clauses = [];

    if (type) {
      const clause = [...base, 'TYPE', type];

      // Without an explicit cast Postgres converts the column with its assignment cast.
      if (cast) {
        clause.push('USING', `${columnName}::${type}`);
      }

      clauses.push(clause);
    }

    if (value) {
      clauses.push([...base, 'SET', 'DEFAULT', value]);
    } else if (value === null) {
      clauses.push([...base, 'DROP', 'DEFAULT']);
    }

    if (required) {
      clauses.push([...base, 'SET', 'NOT', 'null']);
    } else if (required === false) {
      clauses.push([...base, 'DROP', 'NOT', 'null']);
    }

    if (!clauses.length) {
      throw new MissingClauseError();
    }

    return clauses.map((clause) => clause.join(' ')).join(', ');
  }
}
