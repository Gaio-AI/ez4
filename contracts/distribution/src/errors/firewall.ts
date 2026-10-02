import { TypeError } from '@ez4/common/library';

export class InvalidFirewallError extends TypeError {
  constructor(
    public firewall: string | undefined,
    fileName?: string
  ) {
    super(
      firewall
        ? `Invalid CDN firewall, '${firewall}' isn't the ARN of a web ACL with CloudFront scope.`
        : `Invalid CDN firewall, it must resolve to the ARN of a web ACL with CloudFront scope (is its environment variable set?).`,
      fileName
    );
  }
}
