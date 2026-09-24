import { TypeError } from '@ez4/common/library';

export class InvalidScopeHeaderError extends TypeError {
  constructor(
    public scopeKey: string,
    fileName?: string
  ) {
    super(`Invalid scope, header name for '${scopeKey}' must be a string.`, fileName);
  }
}
