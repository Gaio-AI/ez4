import { deepEqual, equal, ok } from 'node:assert/strict';
import { afterEach, beforeEach, describe, it, mock } from 'node:test';

import { LOGGED_ERROR, Runtime, ServiceError } from '@ez4/common';

describe('runtime error report', () => {
  const levels = ['error', 'warn', 'info'] as const;

  let calls: Record<(typeof levels)[number], unknown[][]>;
  let restores: (() => void)[];

  beforeEach(() => {
    Runtime.setScope({ traceId: 'trace-1' });

    calls = { error: [], warn: [], info: [] };

    restores = levels.map((level) => {
      const spy = mock.method(console, level, (...args: unknown[]) => {
        calls[level].push(args);
      });

      return () => spy.mock.restore();
    });
  });

  afterEach(() => {
    restores.forEach((restore) => restore());
    Runtime.clearScope();
  });

  const loggedAt = () => levels.filter((level) => calls[level].length > 0);

  it('assert :: an error without status is an error, with the scope', () => {
    const error = new Error('boom');

    Runtime.reportError(error);

    deepEqual(loggedAt(), ['error']);
    deepEqual(calls.error[0], [{ traceId: 'trace-1', error }]);
  });

  it('assert :: a server error is an error', () => {
    Runtime.reportError(new Error('boom'), 503);

    deepEqual(loggedAt(), ['error']);
  });

  it('assert :: a bad request is a warning', () => {
    Runtime.reportError(new ServiceError('Malformed body payload.'), 400);

    deepEqual(loggedAt(), ['warn']);
  });

  it('assert :: any other client error is information', () => {
    for (const status of [401, 403, 404, 409, 422, 429]) {
      Runtime.reportError(new ServiceError('refused'), status);
    }

    deepEqual(loggedAt(), ['info']);
    equal(calls.info.length, 6);
  });

  it('assert :: an error its own code already logged is not logged again', () => {
    const error = Object.assign(new Error('already told'), { [LOGGED_ERROR]: true });

    Runtime.reportError(error);
    Runtime.reportError(error, 400);

    deepEqual(loggedAt(), []);
  });

  it('assert :: validation details lose the rejected value and keep the rest', () => {
    const error = new ServiceError('Malformed body payload.', {
      details: [
        {
          code: 'UnexpectedPropertiesError',
          path: '$body.actions.n1.data',
          input: { text: 'what the contact wrote' }
        }
      ],
      status: 400
    });

    Runtime.reportError(error, 400);

    const [[{ error: logged }]] = calls.warn as [[{ error: ServiceError }]];

    ok(logged instanceof ServiceError);
    equal(logged.message, 'Malformed body payload.');
    equal(logged.stack, error.stack);
    deepEqual(logged.context, {
      details: [{ code: 'UnexpectedPropertiesError', path: '$body.actions.n1.data' }],
      status: 400
    });

    // The thrown error itself is left as it was: whoever catches it still reads the input.
    ok('input' in (error.context?.details as object[])[0]);
  });
});
