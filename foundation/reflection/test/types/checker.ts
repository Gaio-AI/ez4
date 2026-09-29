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
  field: string;
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
  record: Record<K, boolean>;
  keys: keyof T;
  index: T[K];
  literalIndex: T['size' & keyof T];
  nonNull: NonNullable<T[K] | null>;
  nullable: Unwrap<T> | null;
  list: Unwrap<T>[];
  shape: T['shape' & keyof T];
}

export interface ThroughGeneric {
  value: Generic<Row, RowKeys>;
}

export interface Direct {
  unwrap: Unwrap<Row>;
  isShape: IsShape<Row>;
  elem: Elem<Row[]>;
  optionals: Optionals<Row>;
  record: Record<RowKeys, boolean>;
  keys: keyof Row;
  index: Row[RowKeys];
  literalIndex: Row['size'];
  nonNull: NonNullable<Row[RowKeys] | null>;
  shape: Row['shape'];
  colors: (typeof COLORS)[number];
  template: `on_${'a' | 'b'}`;
  prefixed: Prefixed<'a' | 'b'>;

  // Unrepresentable, stays dropped
  pattern: `on_${string}`;
  dictionary: Record<string, number>;
}
