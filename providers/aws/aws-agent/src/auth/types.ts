import type { Agent } from '@ez4/agent';
import type { EntryState } from '@ez4/state';

export const ProviderCredentialServiceName = 'AWS:SecretsManager/ProviderCredential';
export const ProviderCredentialServiceType = 'aws:secretsmanager.provider-credential';

export type ProviderCredentialParameters = {
  secretName: string;
  provider: Agent.ProviderName;
  envName: string;
};

export type ProviderCredentialResult = {
  secretArn: string;
};

export type ProviderCredentialState = EntryState & {
  type: typeof ProviderCredentialServiceType;
  parameters: ProviderCredentialParameters;
  result?: ProviderCredentialResult;
};
