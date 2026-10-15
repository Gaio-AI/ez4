import type { Arn } from '@ez4/aws-common';

export const buildFileSystemArn = (region: string, accountId: string, fileSystemId: string): Arn => {
  return `arn:aws:elasticfilesystem:${region}:${accountId}:file-system/${fileSystemId}`;
};

export const buildAccessPointArn = (region: string, accountId: string, accessPointId: string): Arn => {
  return `arn:aws:elasticfilesystem:${region}:${accountId}:access-point/${accessPointId}`;
};
