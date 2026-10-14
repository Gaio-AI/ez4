import { TypeError } from '@ez4/common/library';

export class UnknownPresetError extends TypeError {
  constructor(
    public preset: string,
    fileName?: string
  ) {
    super(`Unknown agent permissions preset '${preset}'.`, fileName);
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
