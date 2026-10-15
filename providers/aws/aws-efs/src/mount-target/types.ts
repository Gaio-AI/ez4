import type { EntryState } from '@ez4/state';

export const MountTargetServiceName = 'AWS:EFS/MountTarget';

export const MountTargetServiceType = 'aws:efs.mount-target';

export type MountTargetParameters = {
  subnetId: string;
  securityGroupIds: string[];
};

export type MountTargetResult = {
  mountTargetId: string;
  fileSystemId: string;
};

export type MountTargetState = EntryState & {
  type: typeof MountTargetServiceType;
  parameters: MountTargetParameters;
  result?: MountTargetResult;
};
