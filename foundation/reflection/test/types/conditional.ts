type IsList<T> = T extends readonly unknown[] ? 'list' : 'item';

type ElementOf<T> = T extends readonly unknown[] ? T[number] : T;

type NonNullish<T> = T extends null | undefined ? never : T;

type IsText<T> = T extends string ? 'text' : 'other';

export interface Conditional {
  // Resolved without type parameters
  concrete: string[] extends readonly unknown[] ? number : boolean;

  // Resolved through type parameters
  list: IsList<string[]>;
  tuple: IsList<[string, number]>;
  item: IsList<number>;
  object: IsList<{ foo: string }>;
  element: ElementOf<boolean[]>;
  tupleElement: ElementOf<[string, number]>;

  // Distributed over union members
  distributed: NonNullish<string | null | undefined>;
  mixed: IsText<string | number>;
  flag: IsText<boolean>;

  // Readonly array
  readonly: readonly string[];
}
