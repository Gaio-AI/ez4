export class LocalOptionsNotFoundError extends Error {
  constructor(
    public optionsName: string,
    public serviceName: string
  ) {
    super(`Local options ${optionsName} for database service ${serviceName} wasn't found.`);
  }
}

export class LocalOptionInvalidError extends Error {
  constructor(
    public optionName: string,
    public serviceName: string,
    expected: string
  ) {
    super(`Local option ${optionName} for database service ${serviceName} must be ${expected}.`);
  }
}

export class LocalTableNotReadyError extends Error {
  constructor(public tableName: string) {
    super(`Local table ${tableName} isn't ready.`);
  }
}
