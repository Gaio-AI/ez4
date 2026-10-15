import type { EfsClientPort } from '../src/filesystem/client';
import type { EntryState, StepContext } from '@ez4/state';
import type {
  CreateFileSystemCommandInput,
  CreateAccessPointCommandInput,
  CreateMountTargetCommandInput,
  DeleteFileSystemCommandInput,
  DeleteAccessPointCommandInput,
  DeleteMountTargetCommandInput,
  DescribeFileSystemsCommandInput,
  DescribeAccessPointsCommandInput,
  DescribeMountTargetsCommandInput,
  FileSystemDescription,
  AccessPointDescription,
  MountTargetDescription
} from '@aws-sdk/client-efs';
import type { MountTargetState } from '../src/mount-target/types';
import { MountTargetServiceType } from '../src/mount-target/types';

export type FakeEfsHandlers = {
  onCreate?: (input: CreateFileSystemCommandInput) => void;
  onCreateAccessPoint?: (input: CreateAccessPointCommandInput) => void;
  onCreateMountTarget?: (input: CreateMountTargetCommandInput) => void;
  onDelete?: (input: DeleteFileSystemCommandInput) => void;
  onDeleteAccessPoint?: (input: DeleteAccessPointCommandInput) => void;
  onDeleteMountTarget?: (input: DeleteMountTargetCommandInput) => void;
  onDescribe?: (input: DescribeFileSystemsCommandInput) => {
    FileSystems?: Array<{
      FileSystemId?: string;
      FileSystemArn?: string;
      LifeCycleState?: string;
      CreationToken?: string;
    }>;
  };
  onDescribeAccessPoints?: (input: DescribeAccessPointsCommandInput) => {
    AccessPoints?: Array<{
      AccessPointId?: string;
      AccessPointArn?: string;
      ClientToken?: string;
      LifeCycleState?: string;
      Tags?: Array<{ Key?: string; Value?: string }>;
    }>;
  };
  onDescribeMountTargets?: (input: DescribeMountTargetsCommandInput) => {
    MountTargets?: Array<{
      MountTargetId?: string;
      FileSystemId?: string;
      SubnetId?: string;
      LifeCycleState?: string;
    }>;
  };
};

const defaultMetadata = {
  httpStatusCode: 200,
  requestId: 'req-fake',
  extendedRequestId: undefined,
  cfId: undefined,
  attempts: 1,
  totalRetryDelay: 0
};

export const fakeEfs = (handlers: FakeEfsHandlers = {}): EfsClientPort => ({
  send: (async (command: unknown) => {
    if (!command || typeof command !== 'object' || !('input' in command)) {
      return {};
    }

    const ctor = command.constructor;
    const name = ctor && typeof ctor === 'function' ? ctor.name : undefined;
    const input = command.input;

    if (name === 'CreateFileSystemCommand') {
      const fsInput = input as CreateFileSystemCommandInput;
      handlers.onCreate?.(fsInput);
      return {
        $metadata: defaultMetadata,
        FileSystemId: 'fs-fake123',
        FileSystemArn: 'arn:aws:elasticfilesystem:us-east-1:123456789012:file-system/fs-fake123',
        LifeCycleState: 'available',
        CreationToken: fsInput.CreationToken,
        CreationTime: new Date(),
        NumberOfMountTargets: 0,
        PerformanceMode: 'generalPurpose',
        ThroughputMode: 'elastic',
        Encrypted: true
      };
    }

    if (name === 'CreateAccessPointCommand') {
      const apInput = input as CreateAccessPointCommandInput;
      handlers.onCreateAccessPoint?.(apInput);
      return {
        $metadata: defaultMetadata,
        AccessPointId: 'fsap-fake123',
        AccessPointArn: 'arn:aws:elasticfilesystem:us-east-1:123456789012:access-point/fsap-fake123',
        FileSystemId: apInput.FileSystemId,
        LifeCycleState: 'available'
      };
    }

    if (name === 'CreateMountTargetCommand') {
      const mtInput = input as CreateMountTargetCommandInput;
      handlers.onCreateMountTarget?.(mtInput);
      return {
        $metadata: defaultMetadata,
        MountTargetId: 'fsmt-fake123',
        FileSystemId: mtInput.FileSystemId,
        SubnetId: mtInput.SubnetId,
        LifeCycleState: 'available'
      };
    }

    if (name === 'DescribeFileSystemsCommand') {
      const custom = handlers.onDescribe?.(input as DescribeFileSystemsCommandInput);
      return {
        $metadata: defaultMetadata,
        FileSystems: (custom?.FileSystems ?? []) as FileSystemDescription[]
      };
    }
    if (name === 'DescribeAccessPointsCommand') {
      const custom = handlers.onDescribeAccessPoints?.(input as DescribeAccessPointsCommandInput);
      return {
        $metadata: defaultMetadata,
        AccessPoints: (custom?.AccessPoints ?? []) as AccessPointDescription[]
      };
    }

    if (name === 'DescribeMountTargetsCommand') {
      const custom = handlers.onDescribeMountTargets?.(input as DescribeMountTargetsCommandInput);
      if (custom?.MountTargets) {
        return {
          $metadata: defaultMetadata,
          MountTargets: custom.MountTargets as MountTargetDescription[]
        };
      }
      const mtInput = input as DescribeMountTargetsCommandInput;
      if (mtInput.MountTargetId) {
        return {
          $metadata: defaultMetadata,
          MountTargets: [
            {
              MountTargetId: mtInput.MountTargetId,
              FileSystemId: 'fs-fake123',
              SubnetId: 's-1',
              LifeCycleState: 'available'
            }
          ]
        };
      }
      return {
        $metadata: defaultMetadata,
        MountTargets: []
      };
    }

    if (name === 'DeleteFileSystemCommand') {
      handlers.onDelete?.(input as DeleteFileSystemCommandInput);
      return { $metadata: defaultMetadata };
    }

    if (name === 'DeleteAccessPointCommand') {
      handlers.onDeleteAccessPoint?.(input as DeleteAccessPointCommandInput);
      return { $metadata: defaultMetadata };
    }

    if (name === 'DeleteMountTargetCommand') {
      handlers.onDeleteMountTarget?.(input as DeleteMountTargetCommandInput);
      return { $metadata: defaultMetadata };
    }

    return { $metadata: defaultMetadata };
  }) as EfsClientPort['send']
});

export const fakeMountTarget = (subnetId: string): MountTargetState => ({
  type: MountTargetServiceType,
  entryId: `mt-${subnetId}`,
  dependencies: ['fs-1'],
  parameters: {
    subnetId,
    securityGroupIds: ['sg-1']
  },
  result: {
    mountTargetId: `mt-${subnetId}`,
    fileSystemId: 'fs-1'
  }
});

export const createStepContext = (dependencies: EntryState[] = []): StepContext => ({
  force: true,
  getDependencies: <E extends EntryState>(_type?: string) => dependencies as E[],
  getDependents: <E extends EntryState>(_type?: string) => [] as E[],
  getConnections: <E extends EntryState>(_type?: string) => [] as E[],
  postAction: async () => {},
  addWarning: () => {}
});
