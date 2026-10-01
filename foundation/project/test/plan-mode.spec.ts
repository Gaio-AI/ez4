import type { EntryState, StepState } from '@ez4/state';
import type { InputOptions } from '../src/terminal/options';

import { afterEach, describe, it, mock } from 'node:test';
import { equal } from 'node:assert/strict';

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

let plannedSteps: StepState[] = [];

const lockDeploy = mock.fn();
const saveState = mock.fn();

tryCreateTrigger('Test:plan-mode', {
  'deploy:prepareExecutionRole': ({ state }) => {
    state[plannedEntry.entryId] = plannedEntry;

    return plannedEntry;
  },
  'deploy:plan': () => plannedSteps,
  'deploy:lock': lockDeploy,
  'state:load': () => {
    return Buffer.from(JSON.stringify({ state: { [plannedEntry.entryId]: plannedEntry } }));
  },
  'state:save': saveState
});

describe('plan mode', () => {
  const previousExitCode = process.exitCode;

  afterEach(() => {
    process.exitCode = previousExitCode;

    lockDeploy.mock.resetCalls();
    saveState.mock.resetCalls();
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
