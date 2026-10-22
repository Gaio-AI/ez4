import type { ErrorDetails } from '@ez4/validator';

import { ServiceError } from '@ez4/common';

export class MalformedMessageError extends ServiceError {
  constructor(details: ErrorDetails[]) {
    super('Malformed queue message payload.', { details });
  }
}

/**
 * Thrown by a subscription handler whose work may or may not have happened, such as a request that timed out
 * after it was sent. With idempotency, the key is kept as if the handler ran and the message is consumed, so it
 * runs neither again nor twice; without it, the message fails like with any other error.
 */
export class UnknownOutcomeError extends Error {
  name = 'UnknownOutcomeError';
}

export class MissingMessageGroupError extends Error {
  constructor(public fieldName: string) {
    super(`Message group field '${fieldName}' for the queue is missing.`);
  }
}
