type Kind = 'image' | 'video' | 'audio';

type Base = {
  next: (string | null)[];
  kind: Kind;
};

interface BaseInterface {
  next: (string | null)[];
  kind: Kind;
}

interface ExtendedInterface extends BaseInterface {
  kind: 'image' | 'video';
}

type Facts<K extends Kind, M extends string> = {
  kind: K;
  mime: M;
};

/**
 * Intersections and heritage that narrow a field.
 */
export interface NarrowingTestSchema {
  intersection: Base & { kind: 'image' | 'video' };

  extended: ExtendedInterface;

  distributed: { next: (string | null)[] } & (Facts<'audio', 'audio/aac'> | Facts<'image', 'image/png'>);

  nested: { data: { kind: Kind; size: number } } & { data: { kind: 'audio' } };

  required: { optional?: string; nullable: string | null; both?: string | null } & {
    optional: string;
    nullable: string;
    both?: string | null;
  };
}
