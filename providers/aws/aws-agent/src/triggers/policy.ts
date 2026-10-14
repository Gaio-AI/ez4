import type { PolicyResourceEvent } from '@ez4/project/library';
import { ServiceType } from '@ez4/agent/library';
import { createPolicy, tryGetPolicy, getRegion, getAccountId, createPolicyDocument } from '@ez4/aws-identity';
import { getServiceName } from '@ez4/project/library';
import { getAgentBucketName, getAgentsBaseName } from '../utils/names';

export const buildExecutionPolicy = (event: PolicyResourceEvent, region: string, accountId: string) => {
  const { state, options } = event;
  const policyPrefix = getServiceName('', options);
  const policyName = `${policyPrefix}-agent-execution-policy`;
  const baseName = getAgentsBaseName(options);
  const bucketName = getAgentBucketName(options);

  return (
    tryGetPolicy(state, policyName) ??
    createPolicy(state, {
      policyName,
      policyDocument: createPolicyDocument([
        {
          resourceIds: [`arn:aws:ecs:${region}:${accountId}:task-definition/${baseName}-*`],
          permissions: ['ecs:RunTask']
        },
        {
          resourceIds: [`arn:aws:iam::${accountId}:role/${baseName}-*`],
          permissions: ['iam:PassRole']
        },
        {
          resourceIds: [`arn:aws:s3:::${bucketName}/invocations/*`],
          permissions: ['s3:PutObject']
        },
        {
          resourceIds: [`arn:aws:s3:::${bucketName}/results/*`, `arn:aws:s3:::${bucketName}/artifacts/*`],
          permissions: ['s3:GetObject']
        }
      ]),
      tags: options.tags
    })
  );
};

export const prepareExecutionPolicy = async (event: PolicyResourceEvent) => {
  const { serviceType } = event;

  if (serviceType !== ServiceType) {
    return null;
  }

  const [region, accountId] = await Promise.all([getRegion(), getAccountId()]);
  return buildExecutionPolicy(event, region, accountId);
};
