import { TypeError } from '@ez4/common/library';

export class UnknownPermissionError extends TypeError {
  constructor(
    public permission: string,
    fileName?: string
  ) {
    super(`Unknown agent permission '${permission}', expected an AgentPermission member.`, fileName);
  }
}

export class InvalidReplyToError extends TypeError {
  constructor(
    public replyTo: unknown,
    fileName?: string
  ) {
    super(`Invalid replyTo option '${replyTo}', expected a service reference string.`, fileName);
  }
}
