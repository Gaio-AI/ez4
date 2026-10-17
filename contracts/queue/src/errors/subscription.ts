import { IncompleteTypeError, IncorrectTypeError, InvalidTypeError, UnexpectedValueError } from '@ez4/common/library';

export class IncompleteSubscriptionError extends IncompleteTypeError {
  constructor(properties: string[], fileName?: string) {
    super('Incomplete queue subscription', properties, fileName);
  }
}

export class InvalidSubscriptionTypeError extends InvalidTypeError {
  constructor(fileName?: string) {
    super('Invalid subscription type', undefined, 'Queue.Subscription', fileName);
  }
}

export class IncorrectSubscriptionTypeError extends IncorrectTypeError {
  constructor(
    public subscriptionType: string,
    fileName?: string
  ) {
    super('Incorrect subscription type', subscriptionType, 'Queue.Subscription', fileName);
  }
}

export class InvalidSubscriptionAcknowledgeError extends UnexpectedValueError {
  constructor(acknowledgeValue: string, fileName?: string) {
    super(`Invalid subscription acknowledge, it must be 'record' or 'batch'`, 'acknowledge', acknowledgeValue, fileName);
  }
}

export class InvalidSubscriptionBatchError extends UnexpectedValueError {
  constructor(
    public handlerName: string,
    batchSize: number,
    maxBatchSize: number,
    fileName?: string
  ) {
    super(
      `Invalid batch for subscription ${handlerName}, a FIFO queue takes at most ${maxBatchSize} messages per batch`,
      'batch',
      `${batchSize}`,
      fileName
    );
  }
}
