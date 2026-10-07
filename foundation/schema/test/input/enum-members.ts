import type { Integer, String } from '@ez4/schema';

const enum Kind {
  Image = 'image',
  Video = 'video',
  Audio = 'audio'
}

const enum Mime {
  ImagePng = 'image/png',
  ImageJpeg = 'image/jpeg',
  VideoMp4 = 'video/mp4'
}

const enum Limits {
  MaxText = 10,
  MaxImageSize = 100,
  MaxVideoSize = 200
}

type Upload<K extends Kind, M extends Mime, S extends number> = {
  kind: K;
  mime: M;
  size: Integer.Range<1, S>;
};

type Text<L extends number> = {
  text: String.Max<L>;
};

/**
 * Members of a `const enum` used as literal types and as rich type arguments.
 */
export interface EnumMembersTestSchema {
  members: Mime.ImagePng | Mime.ImageJpeg;

  maxLength: String.Max<Limits.MaxText>;

  generic: Text<Limits.MaxText>;

  narrowed: { kind: Kind } & { kind: Kind.Audio };

  narrowedMany: { kind: Kind } & { kind: Kind.Video | Kind.Audio };

  uploads: { next: string } & (
    | Upload<Kind.Image, Mime.ImagePng | Mime.ImageJpeg, Limits.MaxImageSize>
    | Upload<Kind.Video, Mime.VideoMp4, Limits.MaxVideoSize>
  );
}
