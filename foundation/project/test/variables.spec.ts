import { describe, it } from 'node:test';
import { deepEqual, equal } from 'node:assert/strict';
import { setTimeout as sleep } from 'node:timers/promises';

import { configureVariables, runWithVariables } from '../src/emulator/utils/environment';

const readAfter = (delay: number, name: string) => {
  return async () => {
    await sleep(delay);

    return process.env[name];
  };
};

describe('project emulator variables', () => {
  it('assert :: concurrent invocations keep their own values', async () => {
    const [first, second] = await Promise.all([
      runWithVariables({ SHARED_VARIABLE: 'first' }, readAfter(10, 'SHARED_VARIABLE')),
      runWithVariables({ SHARED_VARIABLE: 'second' }, readAfter(5, 'SHARED_VARIABLE'))
    ]);

    equal(first, 'first');
    equal(second, 'second');
  });

  it('assert :: a variable stays with the invocation that declares it', async () => {
    const [declaring, other] = await Promise.all([
      runWithVariables({ OWN_VARIABLE: 'own' }, readAfter(10, 'OWN_VARIABLE')),
      runWithVariables({}, readAfter(5, 'OWN_VARIABLE'))
    ]);

    equal(declaring, 'own');
    equal(other, undefined);
  });

  it('assert :: nested invocations add their variables', async () => {
    const values = await runWithVariables({ OUTER_VARIABLE: 'outer' }, () => {
      return runWithVariables({ INNER_VARIABLE: 'inner' }, () => ({
        outer: process.env.OUTER_VARIABLE,
        inner: process.env.INNER_VARIABLE
      }));
    });

    deepEqual(values, {
      outer: 'outer',
      inner: 'inner'
    });
  });

  it('assert :: default mode reads the process environment', async () => {
    process.env.PROCESS_VARIABLE = 'process';

    try {
      const value = await runWithVariables({}, readAfter(0, 'PROCESS_VARIABLE'));

      equal(value, 'process');
    } finally {
      delete process.env.PROCESS_VARIABLE;
    }
  });

  it('assert :: strict mode reads only declared, runtime and allowed variables', async () => {
    process.env.UNDECLARED_VARIABLE = 'undeclared';
    process.env.ALLOWED_VARIABLE = 'allowed';

    configureVariables({ strict: true, allowed: ['ALLOWED_VARIABLE'] });

    try {
      const values = await runWithVariables({ DECLARED_VARIABLE: 'declared' }, () => ({
        declared: process.env.DECLARED_VARIABLE,
        undeclared: process.env.UNDECLARED_VARIABLE,
        allowed: process.env.ALLOWED_VARIABLE,
        runtime: process.env.PATH !== undefined,
        listed: Object.keys(process.env).includes('UNDECLARED_VARIABLE')
      }));

      deepEqual(values, {
        declared: 'declared',
        undeclared: undefined,
        allowed: 'allowed',
        runtime: true,
        listed: false
      });

      // Outside any invocation the environment stays whole.
      equal(process.env.UNDECLARED_VARIABLE, 'undeclared');
    } finally {
      configureVariables({ strict: false });

      delete process.env.UNDECLARED_VARIABLE;
      delete process.env.ALLOWED_VARIABLE;
    }
  });
});
