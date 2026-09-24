import { ok, equal } from 'assert/strict';
import { describe, it } from 'node:test';

import { registerTriggers, InvalidScopeHeaderError } from '@ez4/gateway/library';

import { parseFile } from './common/parser';

describe('http scope metadata errors', () => {
  registerTriggers();

  it('assert :: invalid scope header', () => {
    const [error1] = parseFile('invalid-scope', 1);

    ok(error1 instanceof InvalidScopeHeaderError);
    equal(error1.scopeKey, 'clientVersion');
  });
});
