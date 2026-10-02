import type { ModelProperty } from '@ez4/reflection';

import { getPropertyString } from '@ez4/common/library';

import { InvalidFirewallError } from '../errors/firewall';

// A distribution takes only web ACLs created in us-east-1 with CloudFront (global) scope.
const WEB_ACL_ARN = /^arn:[a-z-]+:wafv2:us-east-1:\d{12}:global\/webacl\/[^/]+\/[^/]+$/;

export const getCdnFirewallMetadata = (member: ModelProperty, errorList: Error[], fileName?: string) => {
  const firewall = getPropertyString(member);

  // An unset environment variable leaves no value, and dropping the field would take the web ACL away.
  if (!firewall || !WEB_ACL_ARN.test(firewall)) {
    errorList.push(new InvalidFirewallError(firewall || undefined, fileName));
    return undefined;
  }

  return firewall;
};
