---
'@ez4/reflection': patch
---

Conditional, mapped, template literal and `keyof`/`readonly` types, library aliases other than `Pick`, `Omit`, `Required` and `Partial`, and number-indexed access now resolve through the TypeScript checker when no syntactic resolver handles them. Before, they came out empty or were dropped. A length constant declared as `export type Max = typeof Max` inside a namespace now resolves to its literal, so `String.Max<Constants.Max>` and `String.Size<1, Constants.Max>` start enforcing the `maxLength` they declare. Check request types that use such constants before upgrading: a request that was accepted above that length now gets a 400.
