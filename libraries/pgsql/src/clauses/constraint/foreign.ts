import type { SqlConstraintClause } from './clause';

import { escapeSqlName, escapeSqlNames } from '../../utils/escape';
import { ConstraintAction } from '../types';

export class SqlForeignKeyConstraintClause {
  #state: {
    validate?: boolean;
    constraint: SqlConstraintClause;
    delete?: SqlForeignKeyActionClause;
    update?: SqlForeignKeyActionClause;
    targetColumns: string[];
    sourceColumns: string[];
    sourceTable: string;
  };

  constructor(constraint: SqlConstraintClause, targetColumns: string | string[], sourceTable: string, sourceColumns: string[]) {
    this.#state = {
      targetColumns: Array.isArray(targetColumns) ? targetColumns : [targetColumns],
      sourceTable,
      sourceColumns,
      constraint
    };
  }

  get name() {
    return this.#state.constraint.name;
  }

  columns(columns: string[]) {
    this.#state.sourceColumns = columns;

    return this;
  }

  /**
   * Specify a new source table.
   *
   * @param table Table name.
   * @returns Returns itself.
   */
  source(table: string) {
    this.#state.sourceTable = table;

    return this;
  }

  /**
   * Specify a new target column.
   *
   * @param column Column name.
   * @returns Returns itself.
   */
  target(column: string) {
    this.#state.targetColumns = [column];

    return this;
  }

  delete() {
    if (!this.#state.delete) {
      this.#state.delete = new SqlForeignKeyActionClause(this.#state.constraint);
    }

    return this.#state.delete;
  }

  update() {
    if (!this.#state.update) {
      this.#state.update = new SqlForeignKeyActionClause(this.#state.constraint);
    }

    return this.#state.update;
  }

  validate(validate?: boolean) {
    this.#state.validate = validate;

    return this;
  }

  build() {
    const { validate, constraint, targetColumns, sourceTable, sourceColumns, ...actions } = this.#state;

    if (!constraint.building) {
      return constraint.build();
    }

    const clause = ['ADD', 'CONSTRAINT', escapeSqlName(constraint.name)];

    clause.push('FOREIGN', 'KEY', `(${escapeSqlNames(targetColumns)})`);
    clause.push('REFERENCES', escapeSqlName(sourceTable), `(${escapeSqlNames(sourceColumns)})`);

    const deleteAction = actions.delete?.build();
    const updateAction = actions.update?.build();

    if (deleteAction) {
      clause.push('ON', 'DELETE', deleteAction);
    }

    if (updateAction) {
      clause.push('ON', 'UPDATE', updateAction);
    }

    if (validate === false) {
      clause.push('NOT', 'VALID');
    }

    return clause.join(' ');
  }
}

export class SqlForeignKeyActionClause {
  #state: {
    constraint: SqlConstraintClause;
    action?: ConstraintAction;
    columns?: string[];
  };

  constructor(constraint: SqlConstraintClause) {
    this.#state = {
      constraint
    };
  }

  restrict() {
    this.#state.action = ConstraintAction.Restrict;

    return this;
  }

  cascade() {
    this.#state.action = ConstraintAction.Cascade;

    return this;
  }

  /**
   * Sets the key columns to null, or only the given ones (Postgres 15+), which keeps the others of a
   * key with many columns.
   */
  null(columns?: string[]) {
    this.#state.action = ConstraintAction.Null;
    this.#state.columns = columns;

    return this;
  }

  noAction() {
    this.#state.action = ConstraintAction.NoAction;

    return this;
  }

  build() {
    const { constraint, action, columns } = this.#state;

    if (!constraint.building) {
      return constraint.build();
    }

    switch (action) {
      case ConstraintAction.Restrict:
        return 'RESTRICT';

      case ConstraintAction.Cascade:
        return 'CASCADE';

      case ConstraintAction.Null:
        return columns?.length ? `SET null (${escapeSqlNames(columns)})` : 'SET null';

      case ConstraintAction.NoAction:
        return 'NO ACTION';
    }

    return undefined;
  }
}
