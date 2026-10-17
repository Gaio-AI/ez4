import type { StepContext } from '@ez4/state';

import { describe, it } from 'node:test';
import { deepEqual } from 'node:assert/strict';

import { getFileSystemHandler } from '../src/filesystem/handler';
import { getMountTargetHandler } from '../src/mount-target/handler';
import { getAccessPointHandler } from '../src/access-point/handler';

const makeContext = () => {
  const warnings: string[] = [];

  const context = { force: false, addWarning: (message: string) => warnings.push(message) } as unknown as StepContext;

  return { context, warnings };
};

describe('efs :: deletion needs --force', () => {
  it('keeps the file system, the mount target and the access point, and says so', async () => {
    const calls: string[] = [];
    const { context, warnings } = makeContext();

    const fileSystem = getFileSystemHandler({
      createResource: async () => ({}) as never,
      deleteResource: async () => void calls.push('file system')
    });
    const mountTarget = getMountTargetHandler({
      createResource: async () => ({}) as never,
      deleteResource: async () => void calls.push('mount target')
    });
    const accessPoint = getAccessPointHandler({
      createResource: async () => ({}) as never,
      deleteResource: async () => void calls.push('access point')
    });

    await fileSystem.delete(
      {
        type: 'aws:efs.filesystem',
        entryId: 'f',
        dependencies: [],
        parameters: { fileSystemName: 'stg-agents-workspace' },
        result: { fileSystemId: 'fs-1' }
      } as never,
      context
    );
    await mountTarget.delete(
      {
        type: 'aws:efs.mount-target',
        entryId: 'm',
        dependencies: [],
        parameters: { subnetId: 'subnet-1' },
        result: { mountTargetId: 'mt-1' }
      } as never,
      context
    );
    await accessPoint.delete(
      {
        type: 'aws:efs.access-point',
        entryId: 'a',
        dependencies: [],
        parameters: { accessPointName: 'workspace' },
        result: { accessPointId: 'ap-1' }
      } as never,
      context
    );

    deepEqual(calls, []);
    deepEqual(warnings, [
      "EFS file system 'stg-agents-workspace' was kept; deleting it needs --force.",
      "EFS mount target 'subnet-1' was kept; deleting it needs --force.",
      "EFS access point 'workspace' was kept; deleting it needs --force."
    ]);
  });
});
