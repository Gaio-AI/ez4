export class RoleMissingError extends Error {
  constructor() {
    super(`Execution role for API Gateway is missing.`);
  }
}

export class GroupVpcRequiredError extends Error {
  constructor(public groupName: string) {
    super(`A handler of route group '${groupName}' needs a VPC through its context; set \`vpc: true\` on the group.`);
  }
}

export class IntegrationLimitError extends Error {
  constructor(
    public gatewayName: string,
    public integrations: number,
    public limit: number
  ) {
    super(
      `API '${gatewayName}' needs ${integrations} integrations, one per route handler, and API Gateway takes at most ${limit} per HTTP API. Move routes to another API.`
    );
  }
}
