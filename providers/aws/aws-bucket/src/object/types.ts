import type { ResourceTags } from '@ez4/aws-common';
import type { EntryState } from '@ez4/state';
import type { CreateRequest } from './client';

export const ObjectServiceName = 'AWS:S3/Object';

export const ObjectServiceType = 'aws:s3.object';

export const StaleObjectTag = {
  key: 'ez4:stale',
  value: 'true'
} as const;

export type ObjectParameters = CreateRequest & {
  cacheControl?: string;
  staleExpireDays?: number;
  tags?: ResourceTags;
};

export type ObjectResult = {
  lastModified: number;
  bucketName: string;
};

export type ObjectState = EntryState & {
  type: typeof ObjectServiceType;
  parameters: ObjectParameters;
  result?: ObjectResult;
};
