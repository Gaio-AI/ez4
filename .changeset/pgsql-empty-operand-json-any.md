---
'@ez4/pgsql': patch
'@ez4/pgclient': patch
'@ez4/database': patch
---

A filter whose only condition compares a field to an empty object (`where: { json: { equal: {} } }`, or `not: {}`) keeps its condition. The check that decides whether a WHERE clause is written read the operand `{}` as an empty filter, so the statement went out without WHERE and a `deleteMany` or `updateMany` reached every row; the statement now compares the field to `{}`. The same check dropped such a filter from the `where` of an `upsertOne`, which then updated the existing record whatever it held. Filters that are empty for real (`{}`, `{ id: undefined }`, `{ AND: [] }`) still write no WHERE.

A filter on a field of a JSON column that the schema doesn't declare (an `Object.Any` column, or a key outside the declared ones) binds its value as JSON. It was bound as text or as a number, and Postgres refused the comparison with the JSON field (`operator does not exist: jsonb = text`). An `isIn` on such a field binds each value on its own, since a bound array of plain values doesn't compare as JSON. Fields the schema declares keep their typed comparison.

`removeFrom` on a JSON field removes the key it names even when the key has a comma, a brace, a double quote or a backslash. The path was written into the statement as `'{key}'`, so `'a,b'` removed the nested `a.b` instead, a brace made the statement fail, and a quote or a backslash removed nothing; the path is now a bound `text[]` with the key quoted.

A JSON field typed as an object accepts `isNull`, `isMissing` and `isMissingOrNull` in a filter, as the runtime already handled them.
