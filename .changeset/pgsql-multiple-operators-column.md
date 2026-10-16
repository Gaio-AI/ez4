---
'@ez4/pgsql': patch
---

A filter that gives one column more than one operator (`{ total: { gte: 1, lt: 5 } }`) compares the column as it is, as a single operator does, instead of casting it like a JSON value (`("total")::int`), which kept the column's index out of the plan and overflowed a `bigint` above 2^31. The `insensitive` and `count` flags now apply to every operator of such a filter, and an `isMissing` next to another operator on a JSON field checks the key on its parent.
