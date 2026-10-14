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
