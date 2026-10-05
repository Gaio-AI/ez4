import type { EntryStates } from '@ez4/state';
import type { ProjectStateOptions } from '../types/project';
import type { DeployOptions } from '../types/options';

import { triggerAllAsync } from '@ez4/project/library';

import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { basename } from 'node:path';
import { hash } from 'node:crypto';

import { StaleStateError } from '../errors/state';

export type LoadedState = {
  state: EntryStates;

  /**
   * Digest of the stored state, absent while there is none.
   */
  checksum?: string;
};

export const mergeState = (newState: EntryStates, oldState: EntryStates) => {
  for (const entityId in newState) {
    if (newState[entityId]) {
      newState[entityId].result = oldState[entityId]?.result;
    }
  }
};

export const loadState = async (stateOptions: ProjectStateOptions, deployOptions: DeployOptions): Promise<LoadedState> => {
  const { projectName, branchName } = deployOptions;

  if (!stateOptions.remote) {
    const path = getPath('.', stateOptions.path, branchName);

    if (existsSync(path)) {
      return unpackState(await readFile(path));
    }

    return { state: {} };
  }

  const path = getPath(projectName, stateOptions.path, branchName);

  const data = await triggerAllAsync('state:load', (handler) => {
    return handler({ options: deployOptions, path });
  });

  if (data) {
    return unpackState(data);
  }

  return { state: {} };
};

/**
 * A plan only holds for the state it was made from, and another deploy can save the state while this one waits for
 * the confirmation or the lock. Checked under the lock, the state can't change again until the lock is released.
 */
export const assertStateUnchanged = async (stateOptions: ProjectStateOptions, deployOptions: DeployOptions, checksum?: string) => {
  const currentState = await loadState(stateOptions, deployOptions);

  if (currentState.checksum !== checksum) {
    throw new StaleStateError();
  }
};

export const saveState = async (stateOptions: ProjectStateOptions, deployOptions: DeployOptions, state: EntryStates) => {
  const { projectName, branchName } = deployOptions;

  const data = packState(state);

  if (!stateOptions.remote) {
    const path = getPath('.', stateOptions.path, branchName);

    return writeFile(path, data);
  }

  const path = getPath(projectName, stateOptions.path, branchName);

  return triggerAllAsync('state:save', (handler) =>
    handler({
      options: deployOptions,
      contents: data,
      path
    })
  );
};

const getPath = (baseDirectory: string, filePath: string, branchName: string) => {
  return `${baseDirectory}/${basename(filePath)}${branchName ? `-${branchName}` : ``}.ezstate`;
};

const packState = (state: EntryStates) => {
  const data = {
    lastUpdate: new Date().toISOString(),
    version: 1,
    state
  };

  return JSON.stringify(data, undefined, 2);
};

const unpackState = (buffer: Buffer): LoadedState => {
  const data = JSON.parse(buffer.toString());

  return {
    state: data.state ?? {},
    checksum: hash('sha256', buffer)
  };
};
