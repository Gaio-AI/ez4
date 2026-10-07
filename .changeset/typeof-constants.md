---
'@ez4/reflection': patch
---

`typeof Constant` of a literal `const` resolves to its literal, and a `const X` merged with `type X = typeof X` resolves to the type, also as a type argument (`String.Max<Limits.MaxLength>` through generics kept no `maxLength` before).
