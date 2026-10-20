import { IncompleteTypeError, TypeError } from '@ez4/common/library';

export class IncompleteGuardError extends IncompleteTypeError {
  constructor(fileName?: string) {
    super('Incomplete route guard', [], fileName);
  }
}

export class InvalidRouteAllowError extends TypeError {
  constructor(
    public routePath: string,
    fileName?: string
  ) {
    super(
      `Route '${routePath}' declares an 'allow' that isn't a literal value: a string, number or boolean, or a tuple or object of them.`,
      fileName
    );
  }
}

export class MissingRouteAllowError extends TypeError {
  constructor(
    public routePath: string,
    fileName?: string
  ) {
    super(`Route '${routePath}' declares no 'allow', which the service guard needs to decide who reaches it.`, fileName);
  }
}

export class UnguardedRouteAllowError extends TypeError {
  constructor(
    public routePath: string,
    fileName?: string
  ) {
    super(`Route '${routePath}' declares 'allow', but the service has no guard to enforce it.`, fileName);
  }
}

export class ConflictingRouteAllowError extends TypeError {
  constructor(
    public handlerName: string,
    public routePaths: [string, string],
    fileName?: string
  ) {
    super(
      `Routes '${routePaths[0]}' and '${routePaths[1]}' share the function of handler '${handlerName}' but allow differently.`,
      fileName
    );
  }
}
