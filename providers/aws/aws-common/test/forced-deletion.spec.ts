import type { StepContext } from '@ez4/state';

import { describe, it } from 'node:test';
import { deepEqual, equal } from 'node:assert/strict';

import { allowForcedDeletion } from '../src/common/deletion';

const makeContext = (force: boolean) => {
  const warnings: string[] = [];

  const context = { force, addWarning: (message: string) => warnings.push(message) } as unknown as StepContext;

  return { context, warnings };
};

describe('forced deletion', () => {
  it('allows the deletion with --force, without a warning', () => {
    const { context, warnings } = makeContext(true);

    equal(allowForcedDeletion(context, 'ECR repository', 'stg-agents/implement-agent'), true);
    deepEqual(warnings, []);
  });

  it('keeps the resource without --force and names it in a warning', () => {
    const { context, warnings } = makeContext(false);

    equal(allowForcedDeletion(context, 'ECR repository', 'stg-agents/implement-agent'), false);
    deepEqual(warnings, ["ECR repository 'stg-agents/implement-agent' was kept; deleting it needs --force."]);
  });
});
