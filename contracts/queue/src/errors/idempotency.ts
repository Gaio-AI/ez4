import {
  IncompleteTypeError,
  IncorrectPropertyError,
  IncorrectTypeError,
  InvalidTypeError,
  UnexpectedValueError
} from '@ez4/common/library';

export class IncompleteIdempotencyError extends IncompleteTypeError {
  constructor(properties: string[], fileName?: string) {
    super('Incomplete subscription idempotency', properties, fileName);
  }
}

export class InvalidIdempotencyTypeError extends InvalidTypeError {
  constructor(fileName?: string) {
    super('Invalid subscription idempotency type', undefined, 'Queue.Idempotency', fileName);
  }
}

export class IncorrectIdempotencyTypeError extends IncorrectTypeError {
  constructor(modelType: string, fileName?: string) {
    super('Incorrect subscription idempotency type', modelType, 'Queue.Idempotency', fileName);
  }
}

export class IncorrectIdempotencyKeyError extends IncorrectPropertyError {
  constructor(
    public handlerName: string,
    properties: string[],
    fileName?: string
  ) {
    super(`Incorrect idempotency key for subscription ${handlerName}, each key must be a required message field`, properties, fileName);
  }
}

export class InvalidIdempotencyTtlError extends UnexpectedValueError {
  constructor(ttl: number, fileName?: string) {
    super('Invalid idempotency ttl, it must be a whole number of seconds above zero', 'ttl', `${ttl}`, fileName);
  }
}
