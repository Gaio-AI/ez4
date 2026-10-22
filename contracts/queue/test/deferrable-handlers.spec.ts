import { describe, it } from 'node:test';

import { registerTriggers } from '@ez4/queue/library';

import { parseFile } from './common/parser';

// Which queues take a deferring handler is a type rule, checked by the compiler on test/input/deferrable-handlers.ts
// (its `@ts-expect-error` lines fail the typecheck once the rule is gone). This spec checks the metadata takes both
// request types.
describe('queue deferrable handlers', () => {
  registerTriggers();

  it('assert :: handlers of either request type are read without errors', () => {
    parseFile('deferrable-handlers', 0);
  });
});
