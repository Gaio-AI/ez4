import type { ResourceTags } from '@ez4/aws-common';
import type { EntryState } from '@ez4/state';

export const EcrRepositoryServiceName = 'AWS:ECR/Repository';

export const EcrRepositoryServiceType = 'aws:ecr.repository';

export type EcrRepositoryParameters = {
  repositoryName: string;
  tags?: ResourceTags;
  imageTagMutability?: 'MUTABLE' | 'IMMUTABLE';
  scanOnPush?: boolean;
  lifecyclePolicyText?: string;
};

export type EcrRepositoryResult = {
  repositoryName: string;
  repositoryArn: string;
  repositoryUri: string;
};

export type EcrRepositoryState = EntryState & {
  type: typeof EcrRepositoryServiceType;
  parameters: EcrRepositoryParameters;
  result?: EcrRepositoryResult;
};

export type ImageBuildOptions = {
  agentName: string;
  repositoryUri: string;
  dockerfile: string;
  bundleHash: string;
  bundleFile: string;
  client?: EcrImageClient;
  commandRunner?: (command: string, args: string[], options?: { input?: string; cwd?: string }) => Promise<void>;
};

export type EcrImageClient = {
  imageExists(repositoryName: string, imageTag: string): Promise<boolean>;
  getAuthorizationToken(): Promise<{ authorizationToken?: string; proxyEndpoint?: string }>;
};
