import type { String } from '@ez4/schema';

interface Shape {
  kind: 'circle' | 'square';
  size: number;
}

const COLORS = ['red', 'green'] as const;

type Unwrap<T> = T extends { field: infer F } ? F : never;

type IsShape<T> = T extends Shape ? 'yes' : 'no';

type Elem<T> = T extends (infer E)[] ? E : T;

type Prefixed<K extends string> = `on_${K}`;

type Optionals<T> = { [P in keyof T]?: T[P] };

type Row = {
  field: String.UUID;
  kind: 'circle';
  size: number;
  shape: Shape;
};

type RowKeys = 'kind' | 'size';

interface Generic<T extends object, K extends keyof T> {
  unwrap: Unwrap<T>;
  isShape: IsShape<T>;
  elem: Elem<T[]>;
  optionals: Optionals<T>;
  record: Record<K, number>;
  keys: keyof T;
  index: T[K];
  literalIndex: T['size' & keyof T];
  nonNull: NonNullable<T[K] | null>;
  nullable: Unwrap<T> | null;
  list: Unwrap<T>[];
  shape: T['shape' & keyof T];
}

interface Direct {
  unwrap: Unwrap<Row>;
  isShape: IsShape<Row>;
  elem: Elem<Row[]>;
  optionals: Optionals<Row>;
  record: Record<RowKeys, number>;
  keys: keyof Row;
  index: Row[RowKeys];
  literalIndex: Row['size'];
  nonNull: NonNullable<Row[RowKeys] | null>;
  nullable: Unwrap<Row> | null;
  list: Unwrap<Row>[];
  shape: Row['shape'];
  colors: (typeof COLORS)[number];
  template: `on_${'a' | 'b'}`;
  prefixed: Prefixed<'a' | 'b'>;
  pattern: `on_${string}`;
  dictionary: Record<string, number>;
}

interface Expected {
  unwrap: String.UUID;
  isShape: 'yes';
  elem: Row;
  optionals: Partial<Row>;
  record: { kind: number; size: number };
  keys: 'field' | 'kind' | 'size' | 'shape';
  index: 'circle' | number;
  literalIndex: number;
  nonNull: 'circle' | number;
  nullable: String.UUID | null;
  list: String.UUID[];
  shape: Shape;
  colors: 'red' | 'green';
  template: 'on_a' | 'on_b';
  prefixed: 'on_a' | 'on_b';
}

export interface CheckerFallbackTestSchema {
  generic: Generic<Row, RowKeys>;
  direct: Direct;
  expected: Expected;
}
