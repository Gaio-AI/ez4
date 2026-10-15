import type { MountTargetParameters, MountTargetResult } from './types';
import type { EfsClientPort } from '../filesystem/client';
import type {
  CreateMountTargetCommandInput,
  CreateMountTargetCommandOutput,
  DescribeMountTargetsCommandOutput,
  DeleteMountTargetCommandInput
} from '@aws-sdk/client-efs';

import { CreateMountTargetCommand, DescribeMountTargetsCommand, DeleteMountTargetCommand } from '@aws-sdk/client-efs';

import { Wait } from '@ez4/utils';

export const findMountTarget = async (client: EfsClientPort, fileSystemId: string, subnetId: string): Promise<MountTargetResult | null> => {
  try {
    const response = (await client.send(
      new DescribeMountTargetsCommand({
        FileSystemId: fileSystemId
      })
    )) as DescribeMountTargetsCommandOutput;

    const active = response.MountTargets?.find(
      (mt) => mt.SubnetId === subnetId && mt.LifeCycleState !== 'deleted' && mt.LifeCycleState !== 'deleting'
    );

    if (active?.MountTargetId) {
      return {
        mountTargetId: active.MountTargetId,
        fileSystemId
      };
    }
  } catch (error: unknown) {
    if (error && typeof error === 'object' && 'name' in error && typeof error.name === 'string') {
      if (error.name === 'FileSystemNotFound' || error.name === 'MountTargetNotFound' || error.name === 'BadRequest') {
        return null;
      }
    }
  }

  return null;
};

export const waitForMountTargetAvailable = async (client: EfsClientPort, mountTargetId: string): Promise<void> => {
  await Wait.until(
    async () => {
      const response = (await client.send(
        new DescribeMountTargetsCommand({
          MountTargetId: mountTargetId
        })
      )) as DescribeMountTargetsCommandOutput;

      const target = response.MountTargets?.at(0);
      if (target?.LifeCycleState === 'available') {
        return true;
      }

      if (target?.LifeCycleState === 'error') {
        throw new Error(`Mount target ${mountTargetId} entered error state.`);
      }

      return Wait.RetryAttempt;
    },
    { attempts: 40, minDelay: 2, maxDelay: 10 }
  );
};

export const waitForMountTargetDeleted = async (client: EfsClientPort, mountTargetId: string): Promise<void> => {
  try {
    await Wait.until(
      async () => {
        try {
          const response = (await client.send(
            new DescribeMountTargetsCommand({
              MountTargetId: mountTargetId
            })
          )) as DescribeMountTargetsCommandOutput;

          const target = response.MountTargets?.at(0);
          if (!target || target.LifeCycleState === 'deleted') {
            return true;
          }

          return Wait.RetryAttempt;
        } catch (error: unknown) {
          if (error && typeof error === 'object' && 'name' in error && typeof error.name === 'string') {
            if (error.name === 'MountTargetNotFound') {
              return true;
            }
          }
          throw error;
        }
      },
      { attempts: 40, minDelay: 2, maxDelay: 10 }
    );
  } catch (error: unknown) {
    if (error && typeof error === 'object' && 'name' in error && typeof error.name === 'string') {
      if (error.name === 'MountTargetNotFound') {
        return;
      }
    }
    throw error;
  }
};

export const createMountTargetResource = async (
  client: EfsClientPort,
  fileSystemId: string,
  parameters: MountTargetParameters
): Promise<MountTargetResult> => {
  const existing = await findMountTarget(client, fileSystemId, parameters.subnetId);
  if (existing) {
    await waitForMountTargetAvailable(client, existing.mountTargetId);
    return existing;
  }

  const input: CreateMountTargetCommandInput = {
    FileSystemId: fileSystemId,
    SubnetId: parameters.subnetId,
    SecurityGroups: parameters.securityGroupIds
  };

  const response = (await client.send(new CreateMountTargetCommand(input))) as CreateMountTargetCommandOutput;

  const mountTargetId = response.MountTargetId!;

  await waitForMountTargetAvailable(client, mountTargetId);

  return {
    mountTargetId,
    fileSystemId
  };
};

export const deleteMountTargetResource = async (client: EfsClientPort, result: MountTargetResult): Promise<void> => {
  try {
    const input: DeleteMountTargetCommandInput = {
      MountTargetId: result.mountTargetId
    };
    await client.send(new DeleteMountTargetCommand(input));
  } catch (error: unknown) {
    if (error && typeof error === 'object' && 'name' in error && typeof error.name === 'string') {
      if (error.name === 'MountTargetNotFound') {
        return;
      }
    }
    throw error;
  }

  await waitForMountTargetDeleted(client, result.mountTargetId);
};
