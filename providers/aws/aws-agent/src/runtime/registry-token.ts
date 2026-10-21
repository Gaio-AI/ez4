import { CodeartifactClient, GetAuthorizationTokenCommand } from '@aws-sdk/client-codeartifact';
import { FetchHttpHandler } from '@smithy/fetch-http-handler';
import type { RegistryTokenSource } from './registry';

// `fetch` follows the egress proxy variables the runtime enables; the SDK's default Node handler does not.
export const createCodeArtifactClient = (region: string) => new CodeartifactClient({ region, requestHandler: new FetchHttpHandler() });

export const createRegistryTokenSource =
  (createClient: (region: string) => Pick<CodeartifactClient, 'send'> = createCodeArtifactClient): RegistryTokenSource =>
  async ({ domain, accountId, region }) => {
    const { authorizationToken } = await createClient(region).send(new GetAuthorizationTokenCommand({ domain, domainOwner: accountId }));

    if (!authorizationToken) {
      throw new Error('CodeArtifact returned no token');
    }

    return authorizationToken;
  };
