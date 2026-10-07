type Type<T> = T;

enum Enum {}
class Class {}
function Function(): void {}

const Constant = 1000;
type Constant = typeof Constant;

namespace Limits {
  export const Max = 'max';
  export type Max = typeof Max;
}

type Generic<T> = { value: T };

export interface Typeof {
  // Regular
  regular1: typeof Enum;
  regular2: typeof Class;
  regular3: typeof Function;

  // Template
  template1: Type<typeof Enum>;
  template2: Type<typeof Class>;
  template3: Type<typeof Function>;

  // Literal constant
  constant1: typeof Constant;
  constant2: Constant;
  constant3: Limits.Max;
  constant4: Type<Generic<Constant>>;
}
