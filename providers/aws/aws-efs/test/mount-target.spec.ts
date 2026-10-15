import type { CreateMountTargetCommandInput } from '@aws-sdk/client-efs';
import type { FileSystemState } from '../src/filesystem/types';
import type { MountTargetState } from '../src/mount-target/types';

import { describe, it } from 'node:test';
import { equal, deepEqual, ok } from 'node:assert/strict';

import { createMountTargetResource, deleteMountTargetResource } from '../src/mount-target/client';
import { createMountTarget, createMountTargetStateId, pickSubnetPerZone } from '../src/mount-target/service';
import { getMountTargetHandler } from '../src/mount-target/handler';
import { FileSystemServiceType } from '../src/filesystem/types';
import { MountTargetServiceType } from '../src/mount-target/types';
import { createStepContext, fakeEfs, fakeMountTarget } from './common';

describe('AWS EFS Mount Target', () => {
  it('assert :: one subnet per zone', () => {
    deepEqual(
      pickSubnetPerZone([
        { subnetId: 's-1', availabilityZone: 'us-east-1b' },
        { subnetId: 's-2', availabilityZone: 'us-east-1b' },
        { subnetId: 's-3', availabilityZone: 'us-east-1d' }
      ]),
      ['s-1', 's-3']
    );
  });

  it('assert :: subnet change replaces the mount target', () => {
    const handler = getMountTargetHandler();
    ok(typeof handler.replace === 'function' && !handler.equals(fakeMountTarget('s-1'), fakeMountTarget('s-2')));
  });

  it('assert :: createMountTarget creates valid state entry', () => {
    const state: Record<string, MountTargetState> = {};
    const fileSystem: FileSystemState = {
      type: FileSystemServiceType,
      entryId: 'fs-entry-1',
      dependencies: [],
      parameters: { fileSystemName: 'test-fs' }
    };

    const entry = createMountTarget(state, fileSystem, {
      subnetId: 'subnet-123',
      securityGroupIds: ['sg-abc']
    });

    equal(entry.type, MountTargetServiceType);
    equal(entry.entryId, createMountTargetStateId('fs-entry-1', 'subnet-123'));
    equal(entry.parameters.subnetId, 'subnet-123');
    deepEqual(entry.parameters.securityGroupIds, ['sg-abc']);
    deepEqual(entry.dependencies, ['fs-entry-1']);
    equal(state[entry.entryId], entry);
  });

  it('assert :: createMountTargetResource creates mount target', async () => {
    const calls: CreateMountTargetCommandInput[] = [];
    const client = fakeEfs({
      onCreateMountTarget: (input) => {
        calls.push(input);
      }
    });

    const result = await createMountTargetResource(client, 'fs-123', {
      subnetId: 's-1',
      securityGroupIds: ['sg-1']
    });

    equal(result.mountTargetId, 'fsmt-fake123');
    equal(result.fileSystemId, 'fs-123');
    deepEqual(calls[0], {
      FileSystemId: 'fs-123',
      SubnetId: 's-1',
      SecurityGroups: ['sg-1']
    });
  });

  it('assert :: deleteMountTargetResource deletes mount target', async () => {
    let deletedId: string | undefined;
    const client = fakeEfs({
      onDeleteMountTarget: (input) => {
        deletedId = input.MountTargetId;
      },
      onDescribeMountTargets: () => ({
        MountTargets: []
      })
    });

    await deleteMountTargetResource(client, {
      mountTargetId: 'mt-123',
      fileSystemId: 'fs-123'
    });

    equal(deletedId, 'mt-123');
  });

  it('assert :: handler create and delete execute with step context', async () => {
    let createdSubnet: string | undefined;
    let deletedId: string | undefined;

    const handler = getMountTargetHandler({
      createResource: async (_logger, fsId, params) => {
        createdSubnet = params.subnetId;
        return { mountTargetId: 'mt-new', fileSystemId: fsId };
      },
      deleteResource: async (_logger, res) => {
        deletedId = res.mountTargetId;
      }
    });

    const stepContext = createStepContext([
      {
        type: FileSystemServiceType,
        entryId: 'fs-1',
        dependencies: [],
        parameters: { fileSystemName: 'my-fs' },
        result: { fileSystemId: 'fs-100', fileSystemArn: 'arn:100' }
      }
    ]);

    const candidate: MountTargetState = {
      type: MountTargetServiceType,
      entryId: 'mt-1',
      dependencies: ['fs-1'],
      parameters: { subnetId: 's-1', securityGroupIds: ['sg-1'] }
    };

    await handler.create(candidate, stepContext);
    equal(createdSubnet, 's-1');
    equal(candidate.result?.mountTargetId, 'mt-new');
    equal(candidate.result?.fileSystemId, 'fs-100');

    await handler.delete(candidate, stepContext);
    equal(deletedId, 'mt-new');
  });
});
