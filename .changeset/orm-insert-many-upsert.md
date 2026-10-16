---
'@ez4/database': major
'@ez4/pgsql': minor
'@ez4/pgclient': minor
'@ez4/aws-dynamodb': minor
---

On Postgres `insertMany` sends one multi-row `INSERT` instead of one statement per record. The rows go in chunks that stay under 65,535 bind parameters, 65,536 characters of SQL and 3 MiB of parameters (the Data API takes at most 65,536 characters in a request of at most 4 MiB), and several chunks run in one transaction, the caller's when there is one. `insertMany` takes `skipDuplicates: true`, which adds `ON CONFLICT DO NOTHING` (a record that conflicts on any unique index, primary included, is skipped), and a `select` of table fields that returns the inserted records, only the ones inserted when duplicates are skipped. On DynamoDB `select` returns the written items, and `skipDuplicates` leaves out the items of a cancelled transaction that already exist and sends the others again.

On Postgres `upsertOne` is one `INSERT … ON CONFLICT (<unique index>) DO UPDATE SET … [WHERE <other filters>] RETURNING …`, so concurrent upserts of a new key inside transactions no longer abort them (`25P02`), and a new record costs one statement. Atomic operations address the existing record, an empty `update` becomes `DO NOTHING` followed by a read of the existing record, and an existing record that fails the other filters still throws `DuplicateUniqueKeyError`. The call keeps the update-then-insert path when one statement can't express it (`previous: true`, an insert or update that writes other tables, a `null` or an operator in the unique filters, or an insert whose key differs from the filters), and that path's insert now skips a conflict and retries the update, unless the insert creates related records first. Without `select`, `upsertOne` returns `{ inserted }` alone. `@ez4/pgsql` inserts take several records (`records([…])`, `DEFAULT` for a column another record sets), `conflict()` without columns renders `ON CONFLICT DO NOTHING`, and `conflict(columns, record, filters)` adds the `WHERE` of `DO UPDATE`.

Breaking: `Query.InsertManyInput` and `Query.InsertManyResult` take the select type first (`<S, T>`), and a table client implemented outside ez4 declares `insertMany<S extends Query.InsertManySelectInput<T>>(query: Query.InsertManyInput<S, T>): Promise<Query.InsertManyResult<S, T>>`.
