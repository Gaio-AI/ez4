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
