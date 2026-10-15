import type { EntryState, EntryStates } from '@ez4/state';

import { describe, it } from 'node:test';
import { ok, equal } from 'node:assert/strict';

import { createFileSystem, createAccessPoint, registerTriggers } from '../src/main';

import { deploy } from '@ez4/aws-common';

registerTriggers();

describe('efs lab test', { timeout: 120000 }, () => {
  it('assert :: create, describe and destroy file system and access point', async () => {
    const fsName = `test-lab-fs-${Date.now()}`;
    const newState: EntryStates<EntryState> = {};

    const fsState = createFileSystem(newState, {
      fileSystemName: fsName,
      tags: { Env: 'lab' }
    });

    const apState = createAccessPoint(newState, fsState, {
      accessPointName: `ap-${Date.now()}`,
      path: '/workspace',
      uid: 1000,
      gid: 1000
    });

    const { result: deployedState } = await deploy(newState, undefined);

    const deployedFs = deployedState[fsState.entryId];
    const deployedAp = deployedState[apState.entryId];

    ok(deployedFs?.result);
    ok(deployedAp?.result);

    const { result: destroyedState } = await deploy({}, deployedState);
    equal(Object.keys(destroyedState).length, 0);
  });
});
