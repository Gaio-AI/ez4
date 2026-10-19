---
'@ez4/pgmigration': patch
'@ez4/pgsql': minor
---

Index changes on a table that already exists no longer fail or lock it:

- **Primary key.** Changing its columns (including their order) or adding one to a table that already has another failed with `multiple primary keys for table … are not allowed`, since the new key was added in the rollout while the old one only left in the cleanup. Now the key's index is built with `CREATE UNIQUE INDEX CONCURRENTLY` under a temporary name in the rollout, and the cleanup swaps the keys in one statement (`DROP CONSTRAINT …, ADD CONSTRAINT … PRIMARY KEY USING INDEX …`), then gives the new key its name. The table lock is held only for the swap, not for the build.
- **Invalid index.** A concurrent build that fails (a timeout, duplicates) leaves the index invalid, and `CREATE INDEX … IF NOT EXISTS` kept it that way forever. Before building an index, the migration drops it when it exists, is invalid and no build of it is running.
- **Replaced index.** Changing the type of an index (unique to secondary, and so on) dropped the old one before building the new one. Now the new one is built in the rollout and the old one is dropped in the cleanup, once the code that may rely on it (an upsert on a unique index) is gone. An index whose columns change under the same name is built under a temporary name and swapped in the cleanup.
- **Renamed column.** Renaming an indexed column rebuilt its indexes, and for a primary key it failed like a key change. A renamed column keeps its indexes in Postgres, so now the migration only renames them (`ALTER INDEX … RENAME`, `RENAME CONSTRAINT`).

`@ez4/pgsql`: a primary key constraint can take over an existing unique index with `.primary(columns).index(name)` (`PRIMARY KEY USING INDEX`).
