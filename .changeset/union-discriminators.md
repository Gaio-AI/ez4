---
'@ez4/validator': minor
---

Union validation picks branches by their literal discriminators (also nested, e.g. `type` then `data.kind`): errors come only from the branch the input targets, and an unknown discriminator value is one `UnexpectedEnumValueError` on that property (was `UnexpectedStringError` plus errors from every branch). `Validation.Use` on a union runs its handler once a branch matches, and a handler throwing an `AggregateError` reports each inner error.
