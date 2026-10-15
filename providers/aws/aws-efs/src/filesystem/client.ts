import type { FileSystemParameters, FileSystemResult } from './types';
import type {
  CreateFileSystemCommandInput,
  CreateFileSystemCommandOutput,
  DescribeFileSystemsCommandOutput,
  DeleteFileSystemCommandInput
} from '@aws-sdk/client-efs';

import { EFSClient, CreateFileSystemCommand, DescribeFileSystemsCommand, DeleteFileSystemCommand } from '@aws-sdk/client-efs';

import { getAwsClientOptions, getTagList } from '@ez4/aws-common';

export type EfsClientPort = Pick<EFSClient, 'send'>;

let clientInstance: EfsClientPort | null = null;

export const getEfsClient = (): EfsClientPort => {
  return (clientInstance ??= new EFSClient(getAwsClientOptions()));
};

export const setEfsClient = (client: EfsClientPort | null) => {
  clientInstance = client;
};

export const findFileSystem = async (client: EfsClientPort, creationToken: string): Promise<FileSystemResult | null> => {
  try {
    const response = (await client.send(
      new DescribeFileSystemsCommand({
        CreationToken: creationToken
      })
    )) as DescribeFileSystemsCommandOutput;

    const active = response.FileSystems?.find((fs) => fs.LifeCycleState !== 'deleted' && fs.LifeCycleState !== 'deleting');

    if (active?.FileSystemId && active?.FileSystemArn) {
      return {
        fileSystemId: active.FileSystemId,
        fileSystemArn: active.FileSystemArn
      };
    }
  } catch (error: unknown) {
    if (error && typeof error === 'object' && 'name' in error && typeof error.name === 'string') {
      if (error.name === 'FileSystemNotFound' || error.name === 'BadRequest') {
        return null;
      }
    }
  }

  return null;
};

export const createFileSystemResource = async (client: EfsClientPort, parameters: FileSystemParameters): Promise<FileSystemResult> => {
  const existing = await findFileSystem(client, parameters.fileSystemName);
  if (existing) {
    return existing;
  }

  const input: CreateFileSystemCommandInput = {
    CreationToken: parameters.fileSystemName,
    Encrypted: true,
    PerformanceMode: 'generalPurpose',
    ThroughputMode: 'elastic',
    Tags: getTagList({
      Name: parameters.fileSystemName,
      ...parameters.tags,
      ManagedBy: 'EZ4'
    })
  };

  const response = (await client.send(new CreateFileSystemCommand(input))) as CreateFileSystemCommandOutput;

  return {
    fileSystemId: response.FileSystemId!,
    fileSystemArn: response.FileSystemArn!
  };
};

export const deleteFileSystemResource = async (client: EfsClientPort, result: FileSystemResult): Promise<void> => {
  try {
    const input: DeleteFileSystemCommandInput = {
      FileSystemId: result.fileSystemId
    };
    await client.send(new DeleteFileSystemCommand(input));
  } catch (error: unknown) {
    if (error && typeof error === 'object' && 'name' in error && error.name === 'FileSystemNotFound') {
      return;
    }
    throw error;
  }
};
