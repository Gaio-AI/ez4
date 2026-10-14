import { IncompleteTypeError, TypeError, UnexpectedValueError } from '@ez4/common/library';

export class IncompleteRouteError extends IncompleteTypeError {
  constructor(properties: string[], fileName?: string) {
    super('Incomplete route', properties, fileName);
  }
}

export class InvalidRouteErrorTypeError extends TypeError {
  constructor(fileName?: string) {
    super('Invalid route error type.', fileName);
  }
}

export class InvalidReservedConcurrencyError extends UnexpectedValueError {
  constructor(
    public concurrencyValue: number,
    fileName?: string
  ) {
    super('Invalid reserved concurrency, it must be a positive integer', 'reservedConcurrency', concurrencyValue.toString(), fileName);
  }
}
