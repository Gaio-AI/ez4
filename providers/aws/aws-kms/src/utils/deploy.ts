import { getAwsClientOptions } from '@ez4/aws-common';
import { KMSClient } from '@aws-sdk/client-kms';

export const getKmsClient = () => {
  return new KMSClient(getAwsClientOptions());
};
