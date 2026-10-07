import { defaultProvider } from '@aws-sdk/credential-provider-node';
import { formatUrl } from '@aws-sdk/core/util';
import { HttpRequest } from '@smithy/core/protocols';
import { Sha256 } from '@smithy/core/checksum';
import { SignatureV4 } from '@smithy/signature-v4';

/**
 * IAM authentication token for a database user, the same presigned `connect` request `@aws-sdk/rds-signer`
 * builds, made from the SDK packages the clients already use.
 */
export const getAuthTokenSigner = (hostname: string, port: number, username: string) => {
  const region = process.env.AWS_REGION;

  if (!region) {
    throw new Error('AWS_REGION is required to sign a database authentication token.');
  }

  const signer = new SignatureV4({
    service: 'rds-db',
    credentials: defaultProvider(),
    sha256: Sha256,
    region
  });

  return async (signingDate?: Date) => {
    const request = new HttpRequest({
      method: 'GET',
      protocol: 'https:',
      hostname,
      port,
      query: {
        Action: 'connect',
        DBUser: username
      },
      headers: {
        host: `${hostname}:${port}`
      }
    });

    const presigned = await signer.presign(request, {
      expiresIn: 900,
      signingDate
    });

    return formatUrl(presigned).replace('https://', '');
  };
};
