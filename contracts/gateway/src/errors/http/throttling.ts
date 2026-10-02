import { IncompleteTypeError, IncorrectTypeError, InvalidTypeError, UnexpectedValueError } from '@ez4/common/library';

export class IncompleteThrottlingError extends IncompleteTypeError {
  constructor(properties: string[], fileName?: string) {
    super('Incomplete throttling', properties, fileName);
  }
}

export class InvalidThrottlingTypeError extends InvalidTypeError {
  constructor(fileName?: string) {
    super('Invalid throttling', undefined, 'Http.Throttling', fileName);
  }
}

export class IncorrectThrottlingTypeError extends IncorrectTypeError {
  constructor(
    public throttlingType: string,
    fileName?: string
  ) {
    super('Incorrect throttling', throttlingType, 'Http.Throttling', fileName);
  }
}

export class InvalidThrottlingLimitError extends UnexpectedValueError {
  constructor(
    public limitName: string,
    public limitValue: number,
    fileName?: string
  ) {
    super('Invalid throttling, limits must be positive integers', limitName, limitValue.toString(), fileName);
  }
}
