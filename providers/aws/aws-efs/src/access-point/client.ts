import type { AccessPointParameters, AccessPointResult } from './types';
import type { EfsClientPort } from '../filesystem/client';
import type {
  CreateAccessPointCommandInput,
  CreateAccessPointCommandOutput,
  DescribeAccessPointsCommandOutput,
  DeleteAccessPointCommandInput
} from '@aws-sdk/client-efs';

import { CreateAccessPointCommand, DescribeAccessPointsCommand, DeleteAccessPointCommand } from '@aws-sdk/client-efs';

import { getTagList } from '@ez4/aws-common';
import { getEfsClient } from '../filesystem/client';

export const findAccessPoint = async (
  client: EfsClientPort,
  fileSystemId: string,
  accessPointName: string
): Promise<AccessPointResult | null> => {
  try {
    const response = (await client.send(
      new DescribeAccessPointsCommand({
        FileSystemId: fileSystemId
      })
    )) as DescribeAccessPointsCommandOutput;

    const active = response.AccessPoints?.find((ap) => {
      if (ap.LifeCycleState === 'deleted' || ap.LifeCycleState === 'deleting') {
        return false;
      }
      if (ap.ClientToken === accessPointName) {
        return true;
      }
      return ap.Tags?.some((t) => (t.Key === 'ez4:name' || t.Key === 'Name') && t.Value === accessPointName);
    });

    if (active?.AccessPointId && active?.AccessPointArn) {
      return {
        accessPointId: active.AccessPointId,
        accessPointArn: active.AccessPointArn,
        fileSystemId
      };
    }
  } catch (error: unknown) {
    if (error && typeof error === 'object' && 'name' in error && typeof error.name === 'string') {
      if (error.name === 'FileSystemNotFound' || error.name === 'AccessPointNotFound' || error.name === 'BadRequest') {
        return null;
      }
    }
  }

  return null;
};

export async function createAccessPointResource(
  client: EfsClientPort | undefined,
  fileSystemId: string,
  parameters: AccessPointParameters
): Promise<AccessPointResult>;
export async function createAccessPointResource(fileSystemId: string, parameters: AccessPointParameters): Promise<AccessPointResult>;
export async function createAccessPointResource(
  clientOrFsId: EfsClientPort | string | undefined,
  fsIdOrParams: string | AccessPointParameters,
  maybeParams?: AccessPointParameters
): Promise<AccessPointResult> {
  const isClient = typeof clientOrFsId === 'object' && clientOrFsId !== null && 'send' in clientOrFsId;
  const client = (isClient ? clientOrFsId : undefined) ?? getEfsClient();
  const fileSystemId = (isClient ? (fsIdOrParams as string) : (clientOrFsId as string))!;
  const parameters = (isClient ? maybeParams : (fsIdOrParams as AccessPointParameters))!;

  const existing = await findAccessPoint(client, fileSystemId, parameters.accessPointName);
  if (existing) {
    return existing;
  }

  const input: CreateAccessPointCommandInput = {
    ClientToken: parameters.accessPointName,
    FileSystemId: fileSystemId,
    PosixUser: {
      Uid: parameters.uid,
      Gid: parameters.gid
    },
    RootDirectory: {
      Path: parameters.path,
      CreationInfo: {
        OwnerUid: parameters.uid,
        OwnerGid: parameters.gid,
        Permissions: '0755'
      }
    },
    Tags: getTagList({
      Name: parameters.accessPointName,
      'ez4:name': parameters.accessPointName,
      ...parameters.tags,
      ManagedBy: 'EZ4'
    })
  };

  const response = (await client.send(new CreateAccessPointCommand(input))) as CreateAccessPointCommandOutput;

  return {
    accessPointId: response.AccessPointId!,
    accessPointArn: response.AccessPointArn!,
    fileSystemId
  };
}

export async function deleteAccessPointResource(client: EfsClientPort | undefined, result: AccessPointResult): Promise<void>;
export async function deleteAccessPointResource(result: AccessPointResult): Promise<void>;
export async function deleteAccessPointResource(
  clientOrResult: EfsClientPort | AccessPointResult | undefined,
  maybeResult?: AccessPointResult
): Promise<void> {
  const isClient = clientOrResult && typeof clientOrResult === 'object' && 'send' in clientOrResult;
  const client = (isClient ? clientOrResult : undefined) ?? getEfsClient();
  const result = (isClient ? maybeResult : (clientOrResult as AccessPointResult))!;

  try {
    const input: DeleteAccessPointCommandInput = {
      AccessPointId: result.accessPointId
    };
    await client.send(new DeleteAccessPointCommand(input));
  } catch (error: unknown) {
    if (error && typeof error === 'object' && 'name' in error && typeof error.name === 'string') {
      if (error.name === 'AccessPointNotFound') {
        return;
      }
    }
    throw error;
  }
}
