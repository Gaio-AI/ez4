import type { StepContext } from '@ez4/state';

import { describe, it } from 'node:test';
import { deepEqual } from 'node:assert/strict';

import { getNamespaceHandler } from '../src/namespace/handler';

const makeContext = () => {
  const warnings: string[] = [];

  const context = { force: false, addWarning: (message: string) => warnings.push(message) } as unknown as StepContext;

  return { context, warnings };
};

describe('cloudmap :: deletion needs --force', () => {
  it('keeps the namespace and says so', async () => {
    const calls: string[] = [];
    const { context, warnings } = makeContext();

    await getNamespaceHandler({ deleteResource: async () => void calls.push('namespace') } as never).delete(
      {
        type: 'aws:servicediscovery.namespace',
        entryId: 'n',
        dependencies: [],
        parameters: { namespaceName: 'stg-agents.local' },
        result: { namespaceId: 'ns-1' }
      } as never,
      context
    );

    deepEqual(calls, []);
    deepEqual(warnings, ["Cloud Map namespace 'stg-agents.local' was kept; deleting it needs --force."]);
  });
});
