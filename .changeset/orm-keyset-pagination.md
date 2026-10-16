---
'@ez4/database': minor
'@ez4/pgsql': minor
'@ez4/pgclient': minor
---

Postgres `findMany` pages by cursor: a page with `take` and an `order` reads one record past its end, and when that record exists (it stays out of `records`) the result has `cursor`, so the last page never has one, even when it is full. Passing it back as `cursor` reads the next page from where that one ended, with the same `where` and `order` (`skip` still applies after it, and `count` counts the `where` alone). The cursor keeps the order values at full precision, microseconds included, and goes into the statement as one row comparison that an index on the order columns serves as a range (the expanded `OR` form when the directions mix). A cursor that can't be decoded or was made for another order throws `InvalidCursorError`; a cursor over a nullable order column or on a table without a primary index throws `UnsupportedCursorError`. Whenever a `findMany` (or an `include`) has an order and `take`, `skip` or `cursor`, the primary key columns missing from the order are appended to it in the direction of its last column, so rows that tie on the order no longer move between offset pages either. `@ez4/pgsql` adds `rawCondition`, a SQL condition with bound values, for a list of `AND` or `OR` filters.
