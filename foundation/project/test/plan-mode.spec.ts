import type { EntryState, StepState } from '@ez4/state';
import type { InputOptions } from '../src/terminal/options';

import { afterEach, beforeEach, describe, it, mock } from 'node:test';
import { equal, rejects } from 'node:assert/strict';

import { tryCreateTrigger } from '@ez4/project/library';
import { StepAction } from '@ez4/state';

import { destroyCommand } from '../src/terminal/commands/destroy';
import { deployCommand } from '../src/terminal/commands/deploy';
import { CommandType, getInputOptions } from '../src/terminal/options';

const plannedEntry: EntryState = {
  type: 'test:resource',
  entryId: 'planned-entry',
  dependencies: [],
  parameters: {
    name: 'planned'
  }
};

const getPlanInput = (command: CommandType): InputOptions => ({
  project: 'test/files/plan.project.js',
  plan: true,
  command
});

const getApplyInput = (command: CommandType): InputOptions => ({
  project: 'test/files/plan.project.js',
  command
});

const packState = (lastUpdate?: string) => {
  return Buffer.from(JSON.stringify({ lastUpdate, state: { [plannedEntry.entryId]: plannedEntry } }));
};

const staleStateFailure = {
  message: 'State changed since the plan was made, nothing was applied: run it again to plan against the current state.'
};

let plannedSteps: StepState[] = [];

let storedState: Buffer = packState();

// The state another deploy saves while this one waits for the lock.
let concurrentState: Buffer | undefined;

const lockDeploy = mock.fn(() => {
  if (concurrentState) {
    storedState = concurrentState;
  }
});

const unlockDeploy = mock.fn();
const saveState = mock.fn();

const applyDeploy = mock.fn(() => ({
  result: {},
  warnings: [],
  errors: []
}));

tryCreateTrigger('Test:plan-mode', {
  'deploy:prepareExecutionRole': ({ state }) => {
    state[plannedEntry.entryId] = plannedEntry;

    return plannedEntry;
  },
  'deploy:plan': () => plannedSteps,
  'deploy:apply': applyDeploy,
  'deploy:lock': lockDeploy,
  'deploy:unlock': unlockDeploy,
  'state:load': () => storedState,
  'state:save': saveState
});

// The specs share one trigger registry, so the calls are counted from the start of each test.
const resetProviders = () => {
  storedState = packState();
  concurrentState = undefined;

  lockDeploy.mock.resetCalls();
  unlockDeploy.mock.resetCalls();
  applyDeploy.mock.resetCalls();
  saveState.mock.resetCalls();
};

describe('plan mode', () => {
  const previousExitCode = process.exitCode;

  beforeEach(resetProviders);

  afterEach(() => {
    process.exitCode = previousExitCode;
  });

  it('assert :: deploy plan with changes exits with 2 and applies nothing', async () => {
    plannedSteps = [{ action: StepAction.Create, entryId: plannedEntry.entryId, order: 0 }];

    await deployCommand(getPlanInput(CommandType.Deploy));

    equal(process.exitCode, 2);
    equal(lockDeploy.mock.callCount(), 0);
    equal(saveState.mock.callCount(), 0);
  });

  it('assert :: deploy plan without changes exits with 0', async () => {
    plannedSteps = [];

    await deployCommand(getPlanInput(CommandType.Deploy));

    equal(process.exitCode ?? 0, 0);
    equal(lockDeploy.mock.callCount(), 0);
  });

  it('assert :: destroy plan with changes exits with 2 and destroys nothing', async () => {
    plannedSteps = [{ action: StepAction.Delete, entryId: plannedEntry.entryId, order: 0 }];

    await destroyCommand(getPlanInput(CommandType.Destroy));

    equal(process.exitCode, 2);
    equal(lockDeploy.mock.callCount(), 0);
    equal(saveState.mock.callCount(), 0);
  });

  it('assert :: --plan is read from the command line', () => {
    const previousArgv = process.argv;

    try {
      process.argv = ['node', 'ez4', 'deploy', '--plan'];

      equal(getInputOptions().plan, true);
    } finally {
      process.argv = previousArgv;
    }
  });
});

describe('plan apply', () => {
  beforeEach(resetProviders);

  it('assert :: deploy applies the plan when the state is unchanged', async () => {
    plannedSteps = [{ action: StepAction.Create, entryId: plannedEntry.entryId, order: 0 }];

    await deployCommand(getApplyInput(CommandType.Deploy));

    equal(applyDeploy.mock.callCount(), 1);
    equal(saveState.mock.callCount(), 1);
    equal(unlockDeploy.mock.callCount(), 1);
  });

  it('assert :: deploy applies nothing when the state changed after the plan', async () => {
    plannedSteps = [{ action: StepAction.Create, entryId: plannedEntry.entryId, order: 0 }];
    concurrentState = packState('saved by another deploy');

    await rejects(deployCommand(getApplyInput(CommandType.Deploy)), staleStateFailure, 'the plan was applied over a newer state');

    equal(applyDeploy.mock.callCount(), 0);
    equal(saveState.mock.callCount(), 0);
    equal(unlockDeploy.mock.callCount(), 1);
  });

  it('assert :: destroy destroys nothing when the state changed after the plan', async () => {
    plannedSteps = [{ action: StepAction.Delete, entryId: plannedEntry.entryId, order: 0 }];
    concurrentState = packState('saved by another deploy');

    await rejects(destroyCommand(getApplyInput(CommandType.Destroy)), staleStateFailure, 'the plan was applied over a newer state');

    equal(applyDeploy.mock.callCount(), 0);
    equal(saveState.mock.callCount(), 0);
    equal(unlockDeploy.mock.callCount(), 1);
  });
});
