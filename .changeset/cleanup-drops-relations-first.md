---
'@ez4/pgmigration': minor
'@ez4/aws-aurora': patch
'@ez4/raw-pg': patch
---

The migration cleanup drops and replaces foreign keys before it drops columns, constraints and indexes. Postgres keeps a key or a column while a foreign key references it, so the cleanup used to fail, and fail again on every retry, when one deploy removed a relation along with what it references:

- a relation and the unique key of its related column;
- a relation and the related column;
- a relation that loses its foreign key because the primary key of the related table changed, and that primary key.

The steps that build (prepare and rollout) keep running relations after indexes, since a foreign key needs the key it references.

`getStepStatements(queries, step)` (`@ez4/pgmigration/library`) gives the statements of a step in the order they run. The Aurora and raw Postgres migrations, their local tables and the deploy plan statements all take the order from it.
