import type { EntryState } from '@ez4/state';
import type { CreateRequest, ImportOrCreateResponse } from './client';

export const KeyServiceName = 'AWS:KMS/Key';

export const KeyServiceType = 'aws:kms.key';

export type KeyParameters = CreateRequest;

export type KeyResult = ImportOrCreateResponse;

export type KeyState = EntryState & {
  type: typeof KeyServiceType;
  parameters: KeyParameters;
  result?: KeyResult;
};
