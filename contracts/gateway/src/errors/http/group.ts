import { IncorrectTypeError, InvalidTypeError, TypeError } from '@ez4/common/library';

export class InvalidGroupTypeError extends InvalidTypeError {
  constructor(fileName?: string) {
    super('Invalid group', undefined, 'Http.Group', fileName);
  }
}

export class IncorrectGroupTypeError extends IncorrectTypeError {
  constructor(
    public groupType: string,
    fileName?: string
  ) {
    super('Incorrect group', groupType, 'Http.Group', fileName);
  }
}

export class InvalidRouteGroupError extends TypeError {
  constructor(
    public groupName: string,
    public routePath: string,
    public propertyName: string,
    fileName?: string
  ) {
    super(
      `Route '${routePath}' declares '${propertyName}' apart from its group '${groupName}', set it in the service groups or defaults.`,
      fileName
    );
  }
}

export class ConflictingGroupVariableError extends TypeError {
  constructor(
    public groupName: string,
    public variableName: string,
    fileName?: string
  ) {
    super(`Routes of group '${groupName}' give variable '${variableName}' different values.`, fileName);
  }
}

export class InvalidGroupNameError extends TypeError {
  constructor(
    public groupName: string,
    public functionName: string,
    fileName?: string
  ) {
    super(`Group '${groupName}' names its function '${functionName}', longer than 64 characters.`, fileName);
  }
}

export class GroupNameCollisionError extends TypeError {
  constructor(
    public groupName: string,
    public functionName: string,
    fileName?: string
  ) {
    super(`Group '${groupName}' names its function '${functionName}', which another function of the service already has.`, fileName);
  }
}

export class UnusedGroupError extends TypeError {
  constructor(
    public groupName: string,
    fileName?: string
  ) {
    super(`Group '${groupName}' has settings but no route.`, fileName);
  }
}
