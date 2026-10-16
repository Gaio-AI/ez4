import { registerTriggers as registerAwsTriggers, tryRegisterProvider } from '@ez4/aws-common';
import { getFileSystemHandler } from '../filesystem/handler';
import { FileSystemServiceType } from '../filesystem/types';
import { getMountTargetHandler } from '../mount-target/handler';
import { MountTargetServiceType } from '../mount-target/types';
import { getAccessPointHandler } from '../access-point/handler';
import { AccessPointServiceType } from '../access-point/types';

export const registerTriggers = () => {
  registerAwsTriggers();
  tryRegisterProvider(FileSystemServiceType, getFileSystemHandler());
  tryRegisterProvider(MountTargetServiceType, getMountTargetHandler());
  tryRegisterProvider(AccessPointServiceType, getAccessPointHandler());
};
