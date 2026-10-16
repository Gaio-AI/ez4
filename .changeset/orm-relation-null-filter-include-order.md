---
'@ez4/pgclient': patch
---

A relation filtered with `null` (`where: { relation: null }`) matches the records without a related one, as `NOT EXISTS (… = …)`. It used to render `EXISTS (… != …)`, which matched records with some unrelated row in the other table, so it returned related records and missed the ones it was asked for. An `include` with `order` no longer adds the order fields to each related record nor to the `select` object the caller passed.
