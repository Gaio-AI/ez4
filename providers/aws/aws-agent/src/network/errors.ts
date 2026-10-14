export class MissingAgentNetworkError extends Error {
  constructor(detail: string) {
    super(
      `Failed to discover agent network infrastructure: ${detail}.\n` +
        `Ensure subnets and security groups tagged with 'ez4:agents=true' ` +
        `are provisioned in your VPC (e.g. via gaio-iac).`
    );
    this.name = 'MissingAgentNetworkError';
  }
}
