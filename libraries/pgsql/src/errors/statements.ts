export class MissingTableNameError extends Error {
  constructor() {
    super(`Table name for the statement is missing.`);
  }
}

export class MissingRecordError extends Error {
  constructor() {
    super(`Record for the statement is missing.`);
  }
}

export class EmptyRecordError extends Error {
  constructor() {
    super(`Record for the statement is empty.`);
  }
}

export class MultipleRecordsError extends Error {
  constructor() {
    super(`Multiple records aren't supported for the statement.`);
  }
}
