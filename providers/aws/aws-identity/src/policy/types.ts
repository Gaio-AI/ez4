import type { EntryState, StepContext } from '@ez4/state';
import type { CreateRequest, ImportOrCreateResponse } from './client';

export const PolicyServiceName = 'AWS:IAM/Policy';

export const PolicyServiceType = 'aws:iam.policy';

/**
 * What a policy document can read from the step, both while the plan previews it and while it is applied.
 */
export type PolicyContext = Pick<StepContext, 'force' | 'getDependencies'>;

export type PolicyParameters = CreateRequest & { getPolicyDocument?: (context: PolicyContext) => CreateRequest['policyDocument'] };

export type PolicyResult = ImportOrCreateResponse & {
  versionHistory: string[];
  resolvedDocument?: CreateRequest['policyDocument'];
};

export type PolicyState = EntryState & {
  type: typeof PolicyServiceType;
  parameters: PolicyParameters;
  result?: PolicyResult;
};
