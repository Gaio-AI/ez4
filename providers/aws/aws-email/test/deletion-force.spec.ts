import type { StepContext } from '@ez4/state';

import { describe, it } from 'node:test';
import { deepEqual } from 'node:assert/strict';

import { getIdentityHandler } from '../src/identity/handler';

const makeContext = () => {
  const warnings: string[] = [];

  const context = { force: false, addWarning: (message: string) => warnings.push(message) } as unknown as StepContext;

  return { context, warnings };
};

describe('email :: deletion needs --force', () => {
  it('keeps the identity and says so', async () => {
    const { context, warnings } = makeContext();

    await getIdentityHandler().delete(
      {
        type: 'aws:email.identity',
        entryId: 'i',
        dependencies: [],
        parameters: { identity: 'gaio.social' },
        result: { identityArn: 'arn' }
      } as never,
      context
    );

    deepEqual(warnings, ["Email identity 'gaio.social' was kept; deleting it needs --force."]);
  });
});
