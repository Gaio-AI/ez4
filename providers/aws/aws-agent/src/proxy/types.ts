import type { ResourceTags } from '@ez4/aws-common';
import type { EntryState } from '@ez4/state';

export interface SquidAgentOptions {
  agentName: string;
  allowedDomains: string[];
}

export interface SquidConfigOptions {
  port?: number;
  agents: SquidAgentOptions[];
}

export const ProxyCredentialServiceName = 'AWS:SecretsManager/ProxyCredential';
export const ProxyCredentialServiceType = 'aws:secretsmanager.proxy-credential';

export type ProxyCredentialParameters = {
  secretName: string;
  agentName: string;
  tags?: ResourceTags;
};

export type ProxyCredentialResult = {
  secretName: string;
  secretArn: string;
  agentName: string;
};

export type ProxyCredentialState = EntryState & {
  type: typeof ProxyCredentialServiceType;
  parameters: ProxyCredentialParameters;
  result?: ProxyCredentialResult;
};
