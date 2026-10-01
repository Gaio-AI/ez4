export class RoleMissingError extends Error {
  constructor() {
    super(`Execution role for API Gateway is missing.`);
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
