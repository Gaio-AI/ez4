import { IncompleteTypeError, IncorrectTypeError } from '@ez4/common/library';

export class IncompleteServiceError extends IncompleteTypeError {
  constructor(properties: string[], fileName?: string) {
    super('Incomplete agent service', properties, fileName);
  }
}

export class IncorrectServiceError extends IncorrectTypeError {
  constructor(serviceName: string, fileName?: string) {
    super(`Incorrect agent service '${serviceName}'`, serviceName, 'Agent.Service', fileName);
  }
}

export class InvalidWorkspaceRepoError extends Error {
  constructor(agent: string, url: string) {
    super(`Invalid workspace repository '${url}' in agent '${agent}': expected an HTTPS URL`);
    this.name = 'InvalidWorkspaceRepoError';
  }
}

export class DuplicateWorkspaceRepoError extends Error {
  constructor(agent: string, name: string) {
    super(`Duplicate workspace repository name '${name}' in agent '${agent}'`);
    this.name = 'DuplicateWorkspaceRepoError';
  }
}

export class UnknownWorkflowAgentError extends Error {
  constructor(workflow: string, alias: string) {
    super(`Unknown agent '${alias}' in workflow '${workflow}': expected an Agent.Service class declared in the project`);
    this.name = 'UnknownWorkflowAgentError';
  }
}

export class InvalidMaxStepsError extends Error {
  constructor(workflow: string, value: unknown) {
    super(`Invalid maxSteps '${String(value)}' in workflow '${workflow}': expected an integer from 1 to 100`);
    this.name = 'InvalidMaxStepsError';
  }
}
