---
'@ez4/database': major
'@ez4/pgsql': minor
'@ez4/pgclient': minor
'@ez4/aws-aurora': minor
'@ez4/aws-dynamodb': minor
'@ez4/raw-pg': minor
---

Postgres tables get `aggregate`: `count` (all records, a column's values, or its distinct values), `sum`, `min` and `max`, each under its own alias and optionally with its own `where` (`FILTER (WHERE …)`), grouped by the top-level columns in `by` or as exactly one result without them, with the `where` of `findMany` (relation filters included), `order` by a group column or an alias, `skip` and `take`. Counts come back as numbers, `sum` as a number or `null` when no record matched, and `min`/`max` in the column's own type and output format (date and time through the same `to_char` as every select). The method sits behind a new engine flag, `aggregateMode`, which every engine declares: Aurora and raw-pg support it, and on DynamoDB the input resolves to `never` and the table throws `UnsupportedAggregateError`. `@ez4/pgsql` gains `aggregateColumn` on select statements, and an `ORDER BY` of an aggregate's alias is never qualified by the table alias.

Breaking: a database engine declared outside the ez4 providers adds `aggregateMode` (`AggregateMode.Supported` or `AggregateMode.Unsupported`), or the build rejects it as incomplete.
