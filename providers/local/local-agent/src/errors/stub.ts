export class AgentNotEmulatedError extends Error {
  agentName: string;

  constructor(agentName: string) {
    super(
      `Agent '${agentName}' is not emulated locally in 'ez4 serve'.\n` +
        `Fargate agent emulation is scheduled for Phase 2. ` +
        `To run this agent, deploy to AWS staging with 'ez4 deploy'.`
    );
    this.name = 'AgentNotEmulatedError';
    this.agentName = agentName;
  }
}
