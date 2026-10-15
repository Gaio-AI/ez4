export interface SquidAgentOptions {
  agentName: string;
  allowedDomains: string[];
}

export interface SquidConfigOptions {
  port?: number;
  agents: SquidAgentOptions[];
}
