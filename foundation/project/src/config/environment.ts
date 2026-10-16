import { loadEnvFile } from 'node:process';

import { isAnyObject } from '@ez4/utils';
import { Logger } from '@ez4/logger';

import { triggerAllAsync } from '@ez4/project/library';

/**
 * Let the providers swap the credentials of the environment for the ones of a session, which takes
 * the environment to be loaded first.
 */
export const prepareSession = async () => {
  await triggerAllAsync('session:prepare', (handler) => handler());
};

export const loadEnvironment = (fileName?: string) => {
  try {
    loadEnvFile(fileName);
  } catch (error) {
    if (!isAnyObject(error) || error.code !== 'ENOENT') {
      throw error;
    }

    Logger.warn(`Environment file '${fileName}' wasn't found.`);
  }
};
