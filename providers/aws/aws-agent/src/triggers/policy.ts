import type { PolicyResourceEvent } from '@ez4/project/library';
import { isAgentService, ServiceType } from '@ez4/agent/library';
import { createPolicy, tryGetPolicy, getRegion, getAccountId, createPolicyDocument } from '@ez4/aws-identity';
import { getServiceName } from '@ez4/project/library';
import { getAgentBucketName } from '../utils/names';
import { buildAgentInvokeGrants } from '../role/task';

export const buildExecutionPolicy = (event: PolicyResourceEvent, region: string, accountId: string) => {
  const { state, metadata, options } = event;
  const policyPrefix = getServiceName('', options);
  const policyName = `${policyPrefix}-agent-execution-policy`;
  const bucketName = getAgentBucketName(options);

  const agents = Object.values(metadata ?? {}).filter(isAgentService);
  const agentNames = agents.map((agent) => agent.name);
  const invokeGrants = buildAgentInvokeGrants(agentNames, region, accountId, options);

  return (
    tryGetPolicy(state, policyName) ??
    createPolicy(state, {
      policyName,
      policyDocument: createPolicyDocument([
        ...invokeGrants,
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
