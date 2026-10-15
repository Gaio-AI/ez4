import type { CreateFileSystemCommandInput } from '@aws-sdk/client-efs';
import type { FileSystemState } from '../src/filesystem/types';

import { describe, it } from 'node:test';
import { equal, deepEqual, ok } from 'node:assert/strict';

import { createFileSystemResource, deleteFileSystemResource, setEfsClient } from '../src/filesystem/client';
import { createFileSystem, createFileSystemStateId } from '../src/filesystem/service';
import { getFileSystemHandler } from '../src/filesystem/handler';
import { FileSystemServiceType } from '../src/filesystem/types';
import { createStepContext, fakeEfs } from './common';

describe('AWS EFS File System', () => {
  it('assert :: file system is created encrypted with elastic throughput', async () => {
    const calls: CreateFileSystemCommandInput[] = [];
    await createFileSystemResource(fakeEfs({ onCreate: (input) => calls.push(input) }), {
      fileSystemName: 'stg-agents-workspace'
    });
    deepEqual(calls[0], {
      CreationToken: 'stg-agents-workspace',
      Encrypted: true,
      PerformanceMode: 'generalPurpose',
      ThroughputMode: 'elastic',
      Tags: [
        { Key: 'Name', Value: 'stg-agents-workspace' },
        { Key: 'ManagedBy', Value: 'EZ4' }
      ]
    });
  });

  it('assert :: createFileSystem creates valid state entry', () => {
    const state: Record<string, FileSystemState> = {};
    const entry = createFileSystem(state, {
      fileSystemName: 'test-fs',
      tags: { Env: 'test' }
    });

    equal(entry.type, FileSystemServiceType);
    equal(entry.entryId, createFileSystemStateId('test-fs'));
    equal(entry.parameters.fileSystemName, 'test-fs');
    deepEqual(entry.parameters.tags, { Env: 'test' });
    deepEqual(entry.dependencies, []);
    equal(state[entry.entryId], entry);
  });

  it('assert :: createFileSystemResource returns existing when found', async () => {
    let created = false;
    const client = fakeEfs({
      onDescribe: () => ({
        FileSystems: [
          {
            FileSystemId: 'fs-existing',
            FileSystemArn: 'arn:aws:elasticfilesystem:us-east-1:123:file-system/fs-existing',
            LifeCycleState: 'available'
          }
        ]
      }),
      onCreate: () => {
        created = true;
      }
    });

    const result = await createFileSystemResource(client, { fileSystemName: 'my-fs' });
    equal(result.fileSystemId, 'fs-existing');
    equal(created, false);
  });

  it('assert :: deleteFileSystemResource deletes file system', async () => {
    let deletedId: string | undefined;
    const client = fakeEfs({
      onDelete: (input) => {
        deletedId = input.FileSystemId;
      }
    });

    await deleteFileSystemResource(client, {
      fileSystemId: 'fs-123',
      fileSystemArn: 'arn:aws:elasticfilesystem:us-east-1:123:file-system/fs-123'
    });

    equal(deletedId, 'fs-123');
  });

  it('assert :: handler equals compares fileSystemArn', () => {
    const handler = getFileSystemHandler();
    const s1: FileSystemState = {
      type: FileSystemServiceType,
      entryId: 'e1',
      dependencies: [],
      parameters: { fileSystemName: 'fs1' },
      result: { fileSystemId: 'fs-1', fileSystemArn: 'arn:1' }
    };
    const s2: FileSystemState = {
      type: FileSystemServiceType,
      entryId: 'e2',
      dependencies: [],
      parameters: { fileSystemName: 'fs1' },
      result: { fileSystemId: 'fs-1', fileSystemArn: 'arn:1' }
    };
    const s3: FileSystemState = {
      type: FileSystemServiceType,
      entryId: 'e3',
      dependencies: [],
      parameters: { fileSystemName: 'fs1' },
      result: { fileSystemId: 'fs-2', fileSystemArn: 'arn:2' }
    };

    ok(handler.equals(s1, s2));
    ok(!handler.equals(s1, s3));
  });

  it('assert :: handler create and delete execute with options', async () => {
    let createdName: string | undefined;
    let deletedId: string | undefined;

    const handler = getFileSystemHandler({
      createResource: async (_logger, params) => {
        createdName = params.fileSystemName;
        return { fileSystemId: 'fs-new', fileSystemArn: 'arn:new' };
      },
      deleteResource: async (_logger, res) => {
        deletedId = res.fileSystemId;
      }
    });

    const stepContext = createStepContext();

    const candidate: FileSystemState = {
      type: FileSystemServiceType,
      entryId: 'e1',
      dependencies: [],
      parameters: { fileSystemName: 'fs-create' }
    };

    await handler.create(candidate, stepContext);
    equal(createdName, 'fs-create');
    equal(candidate.result?.fileSystemId, 'fs-new');

    await handler.delete(candidate, stepContext);
    equal(deletedId, 'fs-new');
  });

  it('assert :: handler create without options uses default client from setEfsClient', async () => {
    let createdToken: string | undefined;
    const fake = fakeEfs({
      onCreate: (input) => {
        createdToken = input.CreationToken;
      }
    });

    setEfsClient(fake);
    try {
      const handler = getFileSystemHandler();
      const stepContext = createStepContext();
      const candidate: FileSystemState = {
        type: FileSystemServiceType,
        entryId: 'e-default-fs',
        dependencies: [],
        parameters: { fileSystemName: 'fs-default-client' }
      };

      await handler.create(candidate, stepContext);
      equal(createdToken, 'fs-default-client');
      equal(candidate.result?.fileSystemId, 'fs-fake123');
    } finally {
      setEfsClient(null);
    }
  });
});
