import type { ResourceTags } from '@ez4/aws-common';
import type { EntryState } from '@ez4/state';

export const AccessPointServiceName = 'AWS:EFS/AccessPoint';

export const AccessPointServiceType = 'aws:efs.access-point';

export type AccessPointParameters = {
  accessPointName: string;
  path: string;
  uid: number;
  gid: number;
  tags?: ResourceTags;
};

export type AccessPointResult = {
  accessPointId: string;
  accessPointArn: string;
  fileSystemId: string;
};

export type AccessPointState = EntryState & {
  type: typeof AccessPointServiceType;
  parameters: AccessPointParameters;
  result?: AccessPointResult;
};
