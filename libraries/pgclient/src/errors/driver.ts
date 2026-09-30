export class UnsupportedFieldTypeError extends Error {
  constructor(
    public field: string,
    public type: string
  ) {
    super(`Type '${type}' for field '${field}' isn't supported.`);
  }
}

export class DuplicateUniqueKeyError extends Error {
  constructor() {
    super(`Duplicate key for table was detected.`);
  }
}

export class InternalFailure extends Error {
  constructor(message: string) {
    super(message);

    this.name = 'InternalFailure';
  }
}

export class UnsupportedResultException extends Error {
  constructor(message: string) {
    super(message);

    this.name = 'UnsupportedResultException';
  }
}

export class StatementTimeoutException extends Error {
  constructor(message: string) {
    super(message);

    this.name = 'StatementTimeoutException';
  }
}
