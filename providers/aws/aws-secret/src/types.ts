import type { ResourceTags } from '@ez4/aws-common';
import type { EntryState } from '@ez4/state';

export const SecretServiceName = 'AWS:SecretsManager/Secret';
export const SecretServiceType = 'aws:secretsmanager.secret';

export type SecretValueCallback = () => Promise<Record<string, unknown> | string>;

export type SecretParameters = {
  secretName: string;
  description?: string;
  getSecretValue?: SecretValueCallback;
  retain?: boolean;
  tags?: ResourceTags;
};

export type SecretResult = {
  secretArn: string;
};

export type SecretState = EntryState & {
  type: typeof SecretServiceType;
  parameters: SecretParameters;
  result?: SecretResult;
};
