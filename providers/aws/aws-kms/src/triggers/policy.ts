import type { PolicyResourceEvent } from '@ez4/project/library';

import { createPolicy, createPolicyDocument, getAccountId, getRegion, tryGetPolicy } from '@ez4/aws-identity';
import { ImportType, ServiceType } from '@ez4/encryption/library';
import { getServiceName } from '@ez4/project/library';

/**
 * What the project's functions may do with keys: draw a data key and open one. A key's ARN carries
 * a random id, not its name, so the keys are the ones whose alias starts with the project's prefix
 * or the prefix of a project it imports.
 */
export const prepareExecutionPolicy = async (event: PolicyResourceEvent) => {
  const { state, serviceType, options } = event;

  if (serviceType !== ServiceType && serviceType !== ImportType) {
    return null;
  }

  const prefixList = Object.values({ options, ...options.imports }).map((options) => {
    return getServiceName('', options);
  });

  const [policyPrefix] = prefixList;

  const policyName = `${policyPrefix}-kms-policy`;

  const [region, accountId] = await Promise.all([getRegion(), getAccountId()]);

  return (
    tryGetPolicy(state, policyName) ??
    createPolicy(state, {
      tags: options.tags,
      policyName,
      policyDocument: createPolicyDocument([
        {
          resourceIds: [`arn:aws:kms:${region}:${accountId}:key/*`],
          permissions: ['kms:GenerateDataKey', 'kms:Decrypt'],
          conditions: {
            'ForAnyValue:StringLike': {
              'kms:ResourceAliases': prefixList.map((prefix) => `alias/${prefix}-*`)
            }
          }
        }
      ])
    })
  );
};
