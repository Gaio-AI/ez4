import type { ResourceTags } from '@ez4/aws-common';
import type { EntryState } from '@ez4/state';

export const FileSystemServiceName = 'AWS:EFS/FileSystem';

export const FileSystemServiceType = 'aws:efs.filesystem';

export type FileSystemParameters = {
  fileSystemName: string;
  tags?: ResourceTags;
};

export type FileSystemResult = {
  fileSystemId: string;
  fileSystemArn: string;
};

export type FileSystemState = EntryState & {
  type: typeof FileSystemServiceType;
  parameters: FileSystemParameters;
  result?: FileSystemResult;
};
