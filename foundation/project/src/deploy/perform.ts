import type { DeployOptions } from '../types/options';

import { triggerAllAsync } from '@ez4/project/library';
import { DynamicLogger, Logger } from '@ez4/logger';

import { randomUUID } from 'node:crypto';

export const performDeploy = async <T>(options: DeployOptions, callback: () => Promise<T> | T) => {
  const { lockId } = options;

  const ownerId = randomUUID();

  let isLocked = false;

  const releaseLock = () => {
    return triggerAllAsync('deploy:unlock', (handler) => handler({ lockId, ownerId }));
  };

  const handleShutdown = async () => {
    process.stdin.resume();

    // The signal can come while the lock request is still in flight, so it's released either way: a release only
    // removes the lock this run owns.
    await DynamicLogger.logExecution('\r🔓 Releasing lock (for graceful shutdown)', releaseLock);

    Logger.warn('Deploy interrupted (side effects may have occurred)');

    process.exit(0);
  };

  try {
    process.on('SIGTERM', handleShutdown);
    process.on('SIGINT', handleShutdown);

    await DynamicLogger.logExecution('🔒 Acquiring lock', () => {
      return triggerAllAsync('deploy:lock', (handler) => handler({ lockId, ownerId }));
    });

    isLocked = true;

    return await callback();
  } catch (error) {
    throw error;
  } finally {
    // A deploy that failed to acquire the lock has none to release: the lock in place is another run's.
    if (isLocked) {
      await DynamicLogger.logExecution('🔓 Releasing lock', releaseLock);
    }

    process.off('SIGINT', handleShutdown);
    process.off('SIGTERM', handleShutdown);
  }
};
