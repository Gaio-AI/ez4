export class UnsupportedTransactionError extends Error {
  constructor() {
    super(`DynamoDB tables don't support iterative transactions.`);
  }
}

export class UnsupportedNamedParametersError extends Error {
  constructor() {
    super(`DynamoDB table don't support named parameters.`);
  }
}

export class UnsupportedAggregateError extends Error {
  constructor() {
    super(`DynamoDB tables don't support aggregates.`);
  }
}

export class MissingRepositoryTableError extends Error {
  constructor(public tableAlias: string) {
    super(`DynamoDB table (${tableAlias}) isn't part of the repository.`);
  }
}
