import { afterEach, beforeEach, describe, it } from 'node:test';
import { equal } from 'node:assert/strict';

import { LogColor } from '../src/types/color';
import { LogFormat } from '../src/utils/format';

describe('logger format', () => {
  const { FORCE_COLOR, NO_COLOR } = process.env;
  const { isTTY } = process.stdout;

  beforeEach(() => {
    delete process.env.FORCE_COLOR;
    delete process.env.NO_COLOR;
  });

  afterEach(() => {
    process.env.FORCE_COLOR = FORCE_COLOR;
    process.env.NO_COLOR = NO_COLOR;
    process.stdout.isTTY = isTTY;

    if (FORCE_COLOR === undefined) {
      delete process.env.FORCE_COLOR;
    }

    if (NO_COLOR === undefined) {
      delete process.env.NO_COLOR;
    }
  });

  it('assert :: a terminal gets colors', () => {
    process.stdout.isTTY = true;

    equal(LogFormat.toColor(LogColor.Red, 'text'), '\x1b[31mtext\x1b[0m');
    equal(LogFormat.toBold('text'), '\x1b[1mtext\x1b[0m');
  });

  it('assert :: piped output is plain text', () => {
    process.stdout.isTTY = false;

    equal(LogFormat.toColor(LogColor.Red, 'text'), 'text');
    equal(LogFormat.toBold('text'), 'text');
  });

  it('assert :: NO_COLOR turns colors off in a terminal', () => {
    process.stdout.isTTY = true;
    process.env.NO_COLOR = '1';

    equal(LogFormat.toColor(LogColor.Red, 'text'), 'text');
    equal(LogFormat.toBold('text'), 'text');
  });

  it('assert :: FORCE_COLOR turns colors on in piped output', () => {
    process.stdout.isTTY = false;
    process.env.FORCE_COLOR = '1';

    equal(LogFormat.toColor(LogColor.Red, 'text'), '\x1b[31mtext\x1b[0m');
  });

  it('assert :: FORCE_COLOR=0 turns colors off in a terminal', () => {
    process.stdout.isTTY = true;
    process.env.FORCE_COLOR = '0';

    equal(LogFormat.toColor(LogColor.Red, 'text'), 'text');
  });
});
