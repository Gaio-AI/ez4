export class MissingUniqueIndexError extends Error {
  constructor() {
    super(`Missing unique index for operation`);
  }
}

export class MissingPrimaryIndexError extends Error {
  constructor(public table: string) {
    super(`Table '${table}' has no primary index, which the operation needs to tell its records apart.`);
  }
}

export class MissingFieldSchemaError extends Error {
  constructor(public field: string) {
    super(`Schema for field '${field}' is missing.`);
  }
}

export class InvalidFieldSchemaError extends Error {
  constructor(public field: string) {
    super(`Schema for field '${field}' is invalid.`);
  }
}

export class InvalidRelationFieldError extends Error {
  constructor(public field: string) {
    super(`Relation field '${field}' has an invalid format.`);
  }
}

export class InvalidAtomicOperation extends Error {
  constructor(public field: string) {
    super(`Atomic operation for field '${field}' isn't supported.`);
  }
}

export class InvalidAggregateFieldError extends Error {
  constructor(public alias: string) {
    super(`Aggregate alias '${alias}' must have exactly one of count (true or a column), sum, min or max (a column).`);
  }
}

export class InvalidAggregateColumnError extends Error {
  constructor(
    public alias: string,
    public column: string
  ) {
    super(`Aggregate alias '${alias}' can't aggregate the column '${column}'.`);
  }
}

export class EmptyAggregateQueryError extends Error {
  constructor() {
    super(`Aggregate query must have a group column or an aggregate.`);
  }
}

export class DuplicateAggregateAliasError extends Error {
  constructor(public alias: string) {
    super(`Aggregate alias '${alias}' is also a group column.`);
  }
}

export class InvalidCursorError extends Error {
  constructor(public reason: string) {
    super(`Pagination cursor is invalid: ${reason}.`);
  }
}

export class UnsupportedCursorError extends Error {
  constructor(public reason: string) {
    super(`Pagination cursor isn't supported: ${reason}.`);
  }
}
