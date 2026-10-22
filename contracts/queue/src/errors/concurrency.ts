import {
  IncompleteTypeError,
  IncorrectPropertyError,
  IncorrectTypeError,
  InvalidTypeError,
  UnexpectedValueError
} from '@ez4/common/library';

export class IncompleteKeyConcurrencyError extends IncompleteTypeError {
  constructor(properties: string[], fileName?: string) {
    super('Incomplete subscription key concurrency', properties, fileName);
  }
}

export class InvalidKeyConcurrencyTypeError extends InvalidTypeError {
  constructor(fileName?: string) {
    super('Invalid subscription key concurrency type', undefined, 'Queue.KeyConcurrency', fileName);
  }
}

export class IncorrectKeyConcurrencyTypeError extends IncorrectTypeError {
  constructor(modelType: string, fileName?: string) {
    super('Incorrect subscription key concurrency type', modelType, 'Queue.KeyConcurrency', fileName);
  }
}

export class IncorrectKeyConcurrencyKeyError extends IncorrectPropertyError {
  constructor(
    public handlerName: string,
    properties: string[],
    fileName?: string
  ) {
    super(`Incorrect concurrency key for subscription ${handlerName}, each key must be a required message field`, properties, fileName);
  }
}

export class InvalidKeyConcurrencyMaxError extends UnexpectedValueError {
  constructor(max: number, fileName?: string) {
    super('Invalid key concurrency max, it must be a whole number above zero', 'max', `${max}`, fileName);
  }
}

export class InvalidKeyConcurrencyQueueError extends Error {
  constructor(
    public handlerName: string,
    public fileName?: string
  ) {
    super(`Invalid key concurrency for subscription ${handlerName}, a FIFO queue doesn't take it.`);
  }
}
