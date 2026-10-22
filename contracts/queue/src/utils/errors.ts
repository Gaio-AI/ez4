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

export type SendMessageFailure<T = unknown> = {
  /**
   * Position of the message in the list given to `sendMessages`.
   */
  index: number;

  /**
   * The message that wasn't sent.
   */
  message: T;

  /**
   * Why it wasn't sent.
   */
  error: Error;
};

export class SendMessagesError<T = unknown> extends Error {
  name = 'SendMessagesError';

  constructor(
    public failures: SendMessageFailure<T>[],
    total: number
  ) {
    const reasons = [...new Set(failures.map(({ error }) => error.message))];

    super(`${failures.length} of ${total} messages weren't sent to the queue: ${reasons.join('; ')}`);
  }
}
