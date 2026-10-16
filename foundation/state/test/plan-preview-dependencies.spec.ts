import type { EntryState, EntryStates, StepHandler, StepOptions } from '@ez4/state';

import { describe, it } from 'node:test';
import { deepEqual, equal } from 'node:assert/strict';

import { planSteps } from '@ez4/state';

type PreviewEntry = EntryState & { result?: { arn: string } };

type SeenDependencies = Record<string, (string | undefined)[]>;

const makeEntries = (withResults: boolean): EntryStates<PreviewEntry> => ({
  store: {
    type: 'store',
    entryId: 'store',
    dependencies: [],
    parameters: {},
    result: withResults ? { arn: 'arn:store' } : undefined
  },
  policy: {
    type: 'policy',
    entryId: 'policy',
    dependencies: ['store'],
    parameters: {},
    result: withResults ? { arn: 'arn:policy' } : undefined
  }
});

const makeHandlers = (seen: SeenDependencies) => {
  const handler: StepHandler<PreviewEntry> = {
    equals: () => true,
    create: () => ({}),
    replace: () => ({}),
    preview: (candidate, _current, options: StepOptions) => {
      seen[candidate.entryId] = (options.getDependencies?.<PreviewEntry>() ?? []).map((dependency) => dependency.result?.arn);

      return { counts: 0 };
    },
    update: () => ({}),
    delete: () => {}
  };

  return { store: handler, policy: handler };
};

describe('plan :: dependencies seen by a preview', () => {
  it('assert :: a dependency that is only updated keeps the result of the current state', async () => {
    const seen: SeenDependencies = {};

    await planSteps(makeEntries(true), makeEntries(true), { handlers: makeHandlers(seen) });

    deepEqual(seen.policy, ['arn:store']);
  });

  it('assert :: a dependency the plan creates has no result yet', async () => {
    const seen: SeenDependencies = {};

    const current = makeEntries(true);

    delete current.store;

    await planSteps(makeEntries(true), current, { handlers: makeHandlers(seen) });

    deepEqual(seen.policy, [undefined]);
  });

  it('assert :: an entry without dependencies gets an empty list', async () => {
    const seen: SeenDependencies = {};

    await planSteps(makeEntries(true), makeEntries(true), { handlers: makeHandlers(seen) });

    equal(seen.store.length, 0);
  });
});
