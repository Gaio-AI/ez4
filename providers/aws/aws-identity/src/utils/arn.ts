import type { Arn } from '@ez4/aws-common';

export const buildRoleArn = (accountId: string, roleName: string): Arn => {
  return `arn:aws:iam::${accountId}:role/${roleName}`;
};

export const buildPolicyArn = (accountId: string, policyName: string): Arn => {
  return `arn:aws:iam::${accountId}:policy/${policyName}`;
};

export const buildPermissionsBoundaryArn = (accountId: string, policyName: string | undefined): Arn | undefined => {
  return policyName ? buildPolicyArn(accountId, policyName) : undefined;
};
