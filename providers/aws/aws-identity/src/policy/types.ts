import type { EntryState, StepContext } from '@ez4/state';
import type { CreateRequest, ImportOrCreateResponse } from './client';

export const PolicyServiceName = 'AWS:IAM/Policy';

export const PolicyServiceType = 'aws:iam.policy';

export type PolicyParameters = CreateRequest & { getPolicyDocument?: (context: StepContext) => CreateRequest['policyDocument'] };

export type PolicyResult = ImportOrCreateResponse & {
  versionHistory: string[];
  resolvedDocument?: CreateRequest['policyDocument'];
};

export type PolicyState = EntryState & {
  type: typeof PolicyServiceType;
  parameters: PolicyParameters;
  result?: PolicyResult;
};
