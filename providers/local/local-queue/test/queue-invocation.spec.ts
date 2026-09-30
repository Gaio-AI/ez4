import { deepEqual } from 'node:assert/strict';
import { before, describe, it } from 'node:test';

import { getCurrentInvocation, runWithInvocation } from '@ez4/project/library';

import { getQueueService, loadProbe, startQueue, useQueueProbe } from './queue';
import { waitFor } from './clock';

describe('local queue invocation', () => {
  before(() => loadProbe());

  it('assert :: a batch runs out of the invocation that sent its message', async (t) => {
    const probe = useQueueProbe(t);
    const invocations: unknown[] = [];

    probe.setHandler(() => {
      invocations.push(getCurrentInvocation());
    });

    const { client } = await startQueue(t, getQueueService('invocationQueue'));

    const invocation = {
      services: {
        ['ez4-queue-other-queue']: {
          name: 'override'
        }
      }
    };

    await runWithInvocation(invocation, () => client.sendMessage({ id: 'a' }));

    await waitFor(() => invocations.length === 1);

    deepEqual(invocations, [undefined]);
  });
});
