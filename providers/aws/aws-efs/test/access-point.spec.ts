import type { CreateAccessPointCommandInput } from '@aws-sdk/client-efs';
import type { FileSystemState } from '../src/filesystem/types';
import type { AccessPointState } from '../src/access-point/types';

import { describe, it } from 'node:test';
import { equal, deepEqual, ok } from 'node:assert/strict';

import { createAccessPointResource, deleteAccessPointResource } from '../src/access-point/client';
import { setEfsClient } from '../src/filesystem/client';
import { createAccessPoint, createAccessPointStateId } from '../src/access-point/service';
import { getAccessPointHandler } from '../src/access-point/handler';
import { FileSystemServiceType } from '../src/filesystem/types';
import { AccessPointServiceType } from '../src/access-point/types';
import { createStepContext, fakeEfs } from './common';

describe('AWS EFS Access Point', () => {
  it('assert :: access point pins uid and gid', async () => {
    const calls: CreateAccessPointCommandInput[] = [];
    await createAccessPointResource(fakeEfs({ onCreateAccessPoint: (input) => calls.push(input) }), 'fs-1', {
      accessPointName: 'ws',
      path: '/workspace',
      uid: 1000,
      gid: 1000
    });
    deepEqual(calls[0].PosixUser, { Uid: 1000, Gid: 1000 });
    deepEqual(calls[0].RootDirectory, {
      Path: '/workspace',
      CreationInfo: { OwnerUid: 1000, OwnerGid: 1000, Permissions: '0755' }
    });
  });

  it('assert :: createAccessPoint creates valid state entry', () => {
    const state: Record<string, AccessPointState> = {};
    const fileSystem: FileSystemState = {
      type: FileSystemServiceType,
      entryId: 'fs-entry-1',
      dependencies: [],
      parameters: { fileSystemName: 'test-fs' }
    };

    const entry = createAccessPoint(state, fileSystem, {
      accessPointName: 'my-ap',
      path: '/data',
      uid: 2000,
      gid: 2000,
      tags: { Env: 'prod' }
    });

    equal(entry.type, AccessPointServiceType);
    equal(entry.entryId, createAccessPointStateId('fs-entry-1', 'my-ap'));
    equal(entry.parameters.accessPointName, 'my-ap');
    equal(entry.parameters.path, '/data');
    equal(entry.parameters.uid, 2000);
    equal(entry.parameters.gid, 2000);
    deepEqual(entry.parameters.tags, { Env: 'prod' });
    deepEqual(entry.dependencies, ['fs-entry-1']);
    equal(state[entry.entryId], entry);
  });

  it('assert :: createAccessPointResource returns existing when found', async () => {
    let created = false;
    const client = fakeEfs({
      onDescribeAccessPoints: () => ({
        AccessPoints: [
          {
            AccessPointId: 'fsap-existing',
            AccessPointArn: 'arn:aws:elasticfilesystem:us-east-1:123:access-point/fsap-existing',
            ClientToken: 'existing-ap',
            LifeCycleState: 'available'
          }
        ]
      }),
      onCreateAccessPoint: () => {
        created = true;
      }
    });

    const result = await createAccessPointResource(client, 'fs-123', {
      accessPointName: 'existing-ap',
      path: '/data',
      uid: 1000,
      gid: 1000
    });

    equal(result.accessPointId, 'fsap-existing');
    equal(created, false);
  });

  it('assert :: deleteAccessPointResource deletes access point', async () => {
    let deletedId: string | undefined;
    const client = fakeEfs({
      onDeleteAccessPoint: (input) => {
        deletedId = input.AccessPointId;
      }
    });

    await deleteAccessPointResource(client, {
      accessPointId: 'fsap-123',
      accessPointArn: 'arn:aws:elasticfilesystem:us-east-1:123:access-point/fsap-123',
      fileSystemId: 'fs-123'
    });

    equal(deletedId, 'fsap-123');
  });

  it('assert :: handler equals compares accessPointArn', () => {
    const handler = getAccessPointHandler();
    const s1: AccessPointState = {
      type: AccessPointServiceType,
      entryId: 'e1',
      dependencies: ['fs-1'],
      parameters: { accessPointName: 'ap1', path: '/p', uid: 1000, gid: 1000 },
      result: { accessPointId: 'ap-1', accessPointArn: 'arn:1', fileSystemId: 'fs-1' }
    };
    const s2: AccessPointState = {
      type: AccessPointServiceType,
      entryId: 'e2',
      dependencies: ['fs-1'],
      parameters: { accessPointName: 'ap1', path: '/p', uid: 1000, gid: 1000 },
      result: { accessPointId: 'ap-1', accessPointArn: 'arn:1', fileSystemId: 'fs-1' }
    };
    const s3: AccessPointState = {
      type: AccessPointServiceType,
      entryId: 'e3',
      dependencies: ['fs-1'],
      parameters: { accessPointName: 'ap1', path: '/p', uid: 1000, gid: 1000 },
      result: { accessPointId: 'ap-2', accessPointArn: 'arn:2', fileSystemId: 'fs-1' }
    };

    ok(handler.equals(s1, s2));
    ok(!handler.equals(s1, s3));
  });

  it('assert :: handler create and delete execute with step context', async () => {
    let createdName: string | undefined;
    let deletedId: string | undefined;

    const handler = getAccessPointHandler({
      createResource: async (_logger, fsId, params) => {
        createdName = params.accessPointName;
        return { accessPointId: 'ap-new', accessPointArn: 'arn:new', fileSystemId: fsId };
      },
      deleteResource: async (_logger, res) => {
        deletedId = res.accessPointId;
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

    const candidate: AccessPointState = {
      type: AccessPointServiceType,
      entryId: 'ap-1',
      dependencies: ['fs-1'],
      parameters: { accessPointName: 'test-ap', path: '/work', uid: 1000, gid: 1000 }
    };

    await handler.create(candidate, stepContext);
    equal(createdName, 'test-ap');
    equal(candidate.result?.accessPointId, 'ap-new');
    equal(candidate.result?.fileSystemId, 'fs-100');

    await handler.delete(candidate, stepContext);
    equal(deletedId, 'ap-new');
  });

  it('assert :: handler create without options uses default client from setEfsClient', async () => {
    let createdToken: string | undefined;
    const fake = fakeEfs({
      onCreateAccessPoint: (input) => {
        createdToken = input.ClientToken;
      }
    });

    setEfsClient(fake);
    try {
      const handler = getAccessPointHandler();
      const fileSystem: FileSystemState = {
        type: FileSystemServiceType,
        entryId: 'fs-1',
        dependencies: [],
        parameters: { fileSystemName: 'test-fs' },
        result: {
          fileSystemId: 'fs-123',
          fileSystemArn: 'arn:aws:elasticfilesystem:us-east-1:123:file-system/fs-123'
        }
      };
      const stepContext = createStepContext([fileSystem]);
      const candidate: AccessPointState = {
        type: AccessPointServiceType,
        entryId: 'ap-default',
        dependencies: ['fs-1'],
        parameters: {
          accessPointName: 'ap-default-client',
          path: '/workspace',
          uid: 1000,
          gid: 1000
        }
      };

      await handler.create(candidate, stepContext);
      equal(createdToken, 'ap-default-client');
      equal(candidate.result?.accessPointId, 'fsap-fake123');
      equal(candidate.result?.fileSystemId, 'fs-123');
    } finally {
      setEfsClient(null);
    }
  });
});
