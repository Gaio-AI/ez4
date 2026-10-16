import type { EntryState, EntryStates } from '@ez4/state';

import { describe, it } from 'node:test';
import { ok, equal } from 'node:assert/strict';

import { createFileSystem, createAccessPoint, createMountTarget, registerTriggers } from '../src/main';
import { getDefaultVpcId, getDefaultSubnetIds } from '@ez4/aws-vpc';

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
    let subnetId: string | undefined;
    try {
      const vpcId = await getDefaultVpcId();
      if (vpcId) {
        const subnets = await getDefaultSubnetIds(vpcId);
        subnetId = subnets?.[0];
      }
    } catch {}

    const mtState = subnetId
      ? createMountTarget(newState, fsState, {
          subnetId,
          securityGroupIds: []
        })
      : undefined;

    const { result: deployedState } = await deploy(newState, undefined);

    const deployedFs = deployedState[fsState.entryId];
    const deployedAp = deployedState[apState.entryId];

    ok(deployedFs?.result);
    ok(deployedAp?.result);

    if (mtState) {
      const deployedMt = deployedState[mtState.entryId];
      ok(deployedMt?.result);
    }

    const { result: destroyedState } = await deploy({}, deployedState, { force: true });
    equal(Object.keys(destroyedState).length, 0);
  });
});
