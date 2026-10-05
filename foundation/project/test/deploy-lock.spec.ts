import type { DeployLockEvent, DeployOptions } from '@ez4/project/library';

import { afterEach, describe, it, mock } from 'node:test';
import { equal, notEqual, ok, rejects } from 'node:assert/strict';

import { tryCreateTrigger } from '@ez4/project/library';

import { performDeploy } from '../src/deploy/perform';

const options: DeployOptions = {
  prefix: 'ez4',
  projectName: 'lock',
  branchName: '',
  lockId: 'ez4-lock'
};

const lockFailure = {
  message: 'Failed to acquire exclusive lock.'
};

// The lock store of a provider whose release removes the lock whoever holds it, so what keeps a lock in
// place here is performDeploy alone.
const lockTable = new Map<string, DeployLockEvent>();

const lockEvents: DeployLockEvent[] = [];
const unlockEvents: DeployLockEvent[] = [];

// The specs share one trigger registry, so the store only answers for its own lock.
tryCreateTrigger('Test:deploy-lock', {
  'deploy:lock': (event) => {
    if (event.lockId !== options.lockId) {
      return;
    }

    lockEvents.push(event);

    if (lockTable.has(event.lockId)) {
      throw new Error(lockFailure.message);
    }

    lockTable.set(event.lockId, event);
  },
  'deploy:unlock': (event) => {
    if (event.lockId !== options.lockId) {
      return;
    }

    unlockEvents.push(event);

    lockTable.delete(event.lockId);
  }
});

describe('deploy lock', () => {
  afterEach(() => {
    lockTable.clear();

    lockEvents.splice(0);
    unlockEvents.splice(0);
  });

  it('assert :: a deploy that fails to acquire the lock leaves it to the deploy holding it', async () => {
    let finishApplyA!: () => void;
    let startApplyA!: () => void;

    const applyingA = new Promise<void>((resolve) => {
      startApplyA = resolve;
    });

    const deployA = performDeploy(options, async () => {
      startApplyA();

      await new Promise<void>((resolve) => {
        finishApplyA = resolve;
      });
    });

    await applyingA;

    const applyB = mock.fn();
    const applyC = mock.fn();

    await rejects(performDeploy(options, applyB), lockFailure);

    ok(lockTable.has(options.lockId), 'deploy B released the lock deploy A holds');

    await rejects(performDeploy(options, applyC), lockFailure, 'deploy C acquired the lock while deploy A applies');

    finishApplyA();

    await deployA;

    equal(applyB.mock.callCount(), 0);
    equal(applyC.mock.callCount(), 0);

    equal(lockTable.has(options.lockId), false);
  });

  it('assert :: the lock and its release carry the owner of the run', async () => {
    await performDeploy(options, () => {});
    await performDeploy(options, () => {});

    const [lockA, lockB] = lockEvents;
    const [unlockA, unlockB] = unlockEvents;

    ok(lockA.ownerId);
    ok(lockB.ownerId);

    equal(unlockA.ownerId, lockA.ownerId);
    equal(unlockB.ownerId, lockB.ownerId);

    notEqual(lockA.ownerId, lockB.ownerId);
  });
});
