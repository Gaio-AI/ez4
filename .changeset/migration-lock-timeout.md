---
'@ez4/pgmigration': patch
'@ez4/aws-aurora': patch
'@ez4/raw-pg': patch
---

Migrations no longer queue a table's writes behind a statement waiting for its lock, and long object names no longer break them:

- **Lock timeout.** Every migration statement that takes a table lock (`ALTER TABLE`, `DROP TABLE`, `VALIDATE CONSTRAINT`, renames) runs inside a `DO` block with `lock_timeout = 5s`, and the Aurora and raw Postgres migrations retry it when it times out (`55P03`), up to 10 times. Before, it waited with no timeout behind any open transaction on the table, and every write to that table waited behind it. Statements that run concurrently (`CREATE/DROP INDEX CONCURRENTLY`) take no such lock, can't run in a transaction block and run as they are; they are marked with `concurrent: true`. The local emulators run the same queries. `getMigrationQuery` (`@ez4/pgmigration/library`) builds the query of a statement.
- **Assert timeout.** On Aurora, an assert that doesn't finish within the Data API's time limit (the scan of a large table) no longer fails the migration: the statement it guards, or the validation after it, fails on the same records.
- **Temporary names.** The temporary name of an object being replaced (`…_tmp_pk`, `…_tmp_uk`, `…_tmp_fk`, `…_tmp_ck`) of a name close to 63 bytes was truncated by Postgres into the name of the object it replaces: replacing a primary key of a long name failed with `relation … already exists`. A temporary name that doesn't fit is now shortened with a hash of the full name. Shorter names don't change.
- **Name collisions.** Two object names that are the same once Postgres truncates them to 63 bytes now fail the deploy (and the local emulator) with `MigrationNameCollisionError`. Before, the second object was never created, since its existence check found the first one, and dropping it later dropped the first.
