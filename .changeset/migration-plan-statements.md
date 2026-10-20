---
'@ez4/pgmigration': minor
'@ez4/aws-aurora': minor
'@ez4/raw-pg': minor
---

The deploy plan shows the statements a migration runs, and a database can be migrated outside of the deploy.

- **Statements in the plan.** The migration's plan entry lists the statements of each step under `statements` (`prepare.1`, `rollout.1`, `cleanup.1`…, in the order they run), next to the repository diff. The diff alone hid what a change costs: a new field inside a JSON column emits nothing, while dropping the index of a relation could rebuild its foreign key. `getMigrationStatements` (`@ez4/pgmigration`) builds the list.
- **Migrations outside of the deploy.** `options: { migration: false }` in an Aurora or raw Postgres database service turns the deploy's migrations off. The migration entry stays in the state (removing it would delete the database), so the deploy:
  - creates the database (Aurora) and leaves tables, indexes and constraints alone;
  - shows no schema change in the plan;
  - never drops the database or its tables, not even with `--force`.

  On Aurora, the integrity check still validates the declared indexes and constraints by their names before the functions switch. Local runs still create the tables from the declaration.
