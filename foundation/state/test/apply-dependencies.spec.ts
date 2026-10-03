import type { EntryStates, StepHandlers } from '@ez4/state';
import type { TestEntryState } from './common/entry';

import { planSteps, applySteps, SkipFailedEntryDependencyError } from '@ez4/state';
import { ok, equal, deepEqual } from 'node:assert/strict';
import { describe, it, mock } from 'node:test';

import { commonStepHandler, commonStepHandlers } from './common/handler';
import { TestEntryType } from './common/entry';
import { TestError } from './common/errors';

// Same round trip as the state file between two deploys.
const saveState = (state: EntryStates<TestEntryState>): EntryStates<TestEntryState> => {
  return JSON.parse(JSON.stringify(state));
};

const getStepList = (steps: Awaited<ReturnType<typeof planSteps>>) => {
  return steps.map(({ order, action, entryId }) => `${order}:${action}:${entryId}`);
};

describe('apply dependencies tests', () => {
  it('assert :: delete (dependent rollback)', async () => {
    const oldState: EntryStates<TestEntryState> = {
      entryA: {
        type: TestEntryType.A,
        entryId: 'entryA',
        dependencies: [],
        parameters: {}
      },
      entryB: {
        type: TestEntryType.B,
        entryId: 'entryB',
        dependencies: ['entryA'],
        parameters: {}
      }
    };

    const deleteHandlerA = mock.fn(commonStepHandler.delete);

    const deleteHandlerB = mock.fn(() => {
      throw new TestError();
    });

    const handlers: StepHandlers<TestEntryState> = {
      ...commonStepHandlers,
      [TestEntryType.A]: {
        ...commonStepHandler,
        delete: deleteHandlerA
      },
      [TestEntryType.B]: {
        ...commonStepHandler,
        delete: deleteHandlerB
      }
    };

    const steps = await planSteps(undefined, oldState, { handlers });

    const { result, errors } = await applySteps(steps, undefined, oldState, { handlers });

    const nextSteps = await planSteps(undefined, saveState(result), { handlers });

    deepEqual(getStepList(nextSteps), ['0:delete:entryB', '1:delete:entryA']);

    equal(deleteHandlerB.mock.callCount(), 1);
    equal(deleteHandlerA.mock.callCount(), 0);

    ok(result.entryA);
    ok(result.entryB);

    deepEqual(result.entryB.dependencies, ['entryA']);

    equal(errors.length, 2);

    const [error1, error2] = errors;

    ok(error1 instanceof TestError);
    ok(error2 instanceof SkipFailedEntryDependencyError);
  });

  it('assert :: delete (dependent rollback with kept entries)', async () => {
    const newState: EntryStates<TestEntryState> = {
      entryA: {
        type: TestEntryType.A,
        entryId: 'entryA',
        dependencies: [],
        parameters: {}
      }
    };

    const oldState: EntryStates<TestEntryState> = {
      ...newState,
      entryB: {
        type: TestEntryType.B,
        entryId: 'entryB',
        dependencies: [],
        parameters: {}
      },
      entryC: {
        type: TestEntryType.C,
        entryId: 'entryC',
        dependencies: ['entryB'],
        parameters: {}
      },
      entryD: {
        type: TestEntryType.D,
        entryId: 'entryD',
        dependencies: ['entryC'],
        parameters: {}
      }
    };

    const deleteHandlerB = mock.fn(commonStepHandler.delete);
    const deleteHandlerC = mock.fn(commonStepHandler.delete);

    const deleteHandlerD = mock.fn(() => {
      throw new TestError();
    });

    const handlers: StepHandlers<TestEntryState> = {
      ...commonStepHandlers,
      [TestEntryType.A]: {
        ...commonStepHandler,
        preview: () => undefined
      },
      [TestEntryType.B]: {
        ...commonStepHandler,
        delete: deleteHandlerB
      },
      [TestEntryType.C]: {
        ...commonStepHandler,
        delete: deleteHandlerC
      },
      [TestEntryType.D]: {
        ...commonStepHandler,
        delete: deleteHandlerD
      }
    };

    const steps = await planSteps(newState, oldState, { handlers });

    const { result, errors } = await applySteps(steps, newState, oldState, { handlers });

    const nextSteps = await planSteps(newState, saveState(result), { handlers });

    deepEqual(getStepList(nextSteps), ['0:update:entryA', '1:delete:entryD', '2:delete:entryC', '3:delete:entryB']);

    equal(deleteHandlerD.mock.callCount(), 1);
    equal(deleteHandlerC.mock.callCount(), 0);
    equal(deleteHandlerB.mock.callCount(), 0);

    ok(result.entryA);
    ok(result.entryB);
    ok(result.entryC);
    ok(result.entryD);

    equal(errors.length, 3);

    const [error1, error2, error3] = errors;

    ok(error1 instanceof TestError);
    ok(error2 instanceof SkipFailedEntryDependencyError);
    ok(error3 instanceof SkipFailedEntryDependencyError);
  });

  it('assert :: delete (dependent update rollback)', async () => {
    const oldState: EntryStates<TestEntryState> = {
      entryA: {
        type: TestEntryType.A,
        entryId: 'entryA',
        dependencies: [],
        parameters: {}
      },
      entryB: {
        type: TestEntryType.B,
        entryId: 'entryB',
        dependencies: ['entryA'],
        parameters: {}
      }
    };

    const newState: EntryStates<TestEntryState> = {
      entryC: {
        type: TestEntryType.A,
        entryId: 'entryC',
        dependencies: [],
        parameters: {}
      },
      entryB: {
        type: TestEntryType.B,
        entryId: 'entryB',
        dependencies: ['entryC'],
        parameters: {}
      }
    };

    const deleteHandlerA = mock.fn(commonStepHandler.delete);

    const updateHandlerB = mock.fn(() => {
      throw new TestError();
    });

    const handlers: StepHandlers<TestEntryState> = {
      ...commonStepHandlers,
      [TestEntryType.A]: {
        ...commonStepHandler,
        delete: deleteHandlerA
      },
      [TestEntryType.B]: {
        ...commonStepHandler,
        update: updateHandlerB
      }
    };

    const steps = await planSteps(newState, oldState, { handlers });

    const { result, errors } = await applySteps(steps, newState, oldState, { handlers });

    // The entry that failed to update keeps its old dependency, so a later removal must still find it.
    const nextSteps = await planSteps({ entryC: newState.entryC }, saveState(result), { handlers });

    deepEqual(getStepList(nextSteps), ['0:update:entryC', '1:delete:entryB', '2:delete:entryA']);

    equal(updateHandlerB.mock.callCount(), 1);
    equal(deleteHandlerA.mock.callCount(), 0);

    ok(result.entryA);
    ok(result.entryB);

    deepEqual(result.entryB.dependencies, ['entryA']);

    equal(errors.length, 2);

    const [error1, error2] = errors;

    ok(error1 instanceof TestError);
    ok(error2 instanceof SkipFailedEntryDependencyError);
  });

  it('assert :: update (no preview, dependency replaced)', async () => {
    const oldState: EntryStates<TestEntryState> = {
      entryA: {
        type: TestEntryType.A,
        entryId: 'entryA',
        dependencies: [],
        parameters: {}
      },
      entryB: {
        type: TestEntryType.B,
        entryId: 'entryB',
        dependencies: [],
        parameters: {}
      },
      entryC: {
        type: TestEntryType.C,
        entryId: 'entryC',
        dependencies: ['entryA', 'entryB'],
        parameters: {}
      }
    };

    const newState: EntryStates<TestEntryState> = {
      entryA: oldState.entryA,
      entryD: {
        type: TestEntryType.B,
        entryId: 'entryD',
        dependencies: [],
        parameters: {}
      },
      entryC: {
        type: TestEntryType.C,
        entryId: 'entryC',
        connections: ['entryD'],
        dependencies: ['entryA', 'entryD'],
        parameters: {}
      }
    };

    const updateHandlerC = mock.fn(commonStepHandler.update);

    const handlers: StepHandlers<TestEntryState> = {
      ...commonStepHandlers,
      [TestEntryType.A]: {
        ...commonStepHandler,
        preview: () => undefined
      },
      [TestEntryType.C]: {
        ...commonStepHandler,
        preview: () => undefined,
        update: updateHandlerC
      }
    };

    const steps = await planSteps(newState, oldState, { handlers });

    const { result, errors } = await applySteps(steps, newState, oldState, { handlers });

    // A later deploy removes the entry whose update was skipped.
    const nextSteps = await planSteps({ entryA: newState.entryA, entryD: newState.entryD }, saveState(result), { handlers });

    deepEqual(getStepList(nextSteps), ['0:update:entryA', '0:update:entryD', '1:delete:entryC']);

    equal(updateHandlerC.mock.callCount(), 0);

    ok(result.entryC);
    equal(result.entryB, undefined);

    deepEqual(result.entryC.dependencies, ['entryA', 'entryD']);
    deepEqual(result.entryC.connections, ['entryD']);

    equal(errors.length, 0);
  });

  it('assert :: update (no preview, replaced dependency error)', async () => {
    const oldState: EntryStates<TestEntryState> = {
      entryA: {
        type: TestEntryType.A,
        entryId: 'entryA',
        dependencies: [],
        parameters: {}
      },
      entryB: {
        type: TestEntryType.B,
        entryId: 'entryB',
        dependencies: [],
        parameters: {}
      },
      entryC: {
        type: TestEntryType.C,
        entryId: 'entryC',
        dependencies: ['entryA', 'entryB'],
        parameters: {}
      }
    };

    const newState: EntryStates<TestEntryState> = {
      entryA: oldState.entryA,
      entryD: {
        type: TestEntryType.D,
        entryId: 'entryD',
        dependencies: [],
        parameters: {}
      },
      entryC: {
        type: TestEntryType.C,
        entryId: 'entryC',
        dependencies: ['entryA', 'entryD'],
        parameters: {}
      }
    };

    const deleteHandlerB = mock.fn(commonStepHandler.delete);

    const createHandlerD = mock.fn(() => {
      throw new TestError();
    });

    const handlers: StepHandlers<TestEntryState> = {
      ...commonStepHandlers,
      [TestEntryType.A]: {
        ...commonStepHandler,
        preview: () => undefined
      },
      [TestEntryType.B]: {
        ...commonStepHandler,
        delete: deleteHandlerB
      },
      [TestEntryType.C]: {
        ...commonStepHandler,
        preview: () => undefined
      },
      [TestEntryType.D]: {
        ...commonStepHandler,
        create: createHandlerD
      }
    };

    const steps = await planSteps(newState, oldState, { handlers });

    const { result, errors } = await applySteps(steps, newState, oldState, { handlers });

    // A later deploy removes the entry whose update was skipped, along with its new dependency.
    const nextSteps = await planSteps({ entryA: newState.entryA }, saveState(result), { handlers });

    deepEqual(getStepList(nextSteps), ['0:update:entryA', '1:delete:entryC', '2:delete:entryB']);

    equal(createHandlerD.mock.callCount(), 1);
    equal(deleteHandlerB.mock.callCount(), 0);

    ok(result.entryB);
    ok(result.entryC);
    equal(result.entryD, undefined);

    deepEqual(result.entryC.dependencies, ['entryA', 'entryB']);

    equal(errors.length, 3);

    const [error1, error2, error3] = errors;

    ok(error1 instanceof TestError);
    ok(error2 instanceof SkipFailedEntryDependencyError);
    ok(error3 instanceof SkipFailedEntryDependencyError);
  });

  it('assert :: update (dependency replaced)', async () => {
    const oldState: EntryStates<TestEntryState> = {
      entryA: {
        type: TestEntryType.A,
        entryId: 'entryA',
        dependencies: [],
        parameters: {}
      },
      entryB: {
        type: TestEntryType.B,
        entryId: 'entryB',
        dependencies: [],
        parameters: {}
      },
      entryC: {
        type: TestEntryType.C,
        entryId: 'entryC',
        dependencies: ['entryA', 'entryB'],
        parameters: {}
      }
    };

    const newState: EntryStates<TestEntryState> = {
      entryA: oldState.entryA,
      entryD: {
        type: TestEntryType.B,
        entryId: 'entryD',
        dependencies: [],
        parameters: {}
      },
      entryC: {
        type: TestEntryType.C,
        entryId: 'entryC',
        dependencies: ['entryA', 'entryD'],
        parameters: {}
      }
    };

    const updateHandlerC = mock.fn(commonStepHandler.update);

    const handlers: StepHandlers<TestEntryState> = {
      ...commonStepHandlers,
      [TestEntryType.A]: {
        ...commonStepHandler,
        preview: () => undefined
      },
      [TestEntryType.C]: {
        ...commonStepHandler,
        update: updateHandlerC
      }
    };

    const steps = await planSteps(newState, oldState, { handlers });

    const { result, errors } = await applySteps(steps, newState, oldState, { handlers });

    const nextSteps = await planSteps({ entryA: newState.entryA, entryD: newState.entryD }, saveState(result), { handlers });

    deepEqual(getStepList(nextSteps), ['0:update:entryA', '0:update:entryD', '1:delete:entryC']);

    equal(updateHandlerC.mock.callCount(), 1);

    ok(result.entryC);
    equal(result.entryB, undefined);

    deepEqual(result.entryC.dependencies, ['entryA', 'entryD']);
    deepEqual(result.entryC.result, { type: 'updated' });

    equal(errors.length, 0);
  });
});
