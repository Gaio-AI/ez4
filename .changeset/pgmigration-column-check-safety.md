---
'@ez4/pgsql': minor
'@ez4/pgmigration': patch
---

Lowering a string column's `maxLength`, or adding one to an unbounded string column, no longer truncates existing values. The migration emitted `ALTER COLUMN … TYPE varchar(n) USING "column"::varchar(n)`, and an explicit cast to `varchar(n)` silently cuts a longer value down to `n` characters. It now emits `ALTER COLUMN … TYPE varchar(n)` with no `USING`, so Postgres converts with its assignment cast: a value that doesn't fit fails the migration with `value too long for type character varying(n)` and every row stays as it was. Raising `maxLength` stays a catalog-only change, with no table rewrite. Every other target type keeps its `USING "column"::type`.

Adding a value to an enum or literal column no longer scans the whole table before widening its check. The rollout swap that widens the check to the old and the new values first ran `SELECT 1 FROM table WHERE NOT column IN (…)`, which on a large table outlasts the 45 seconds the Aurora Data API allows and failed the migration. The widened check holds every value the current one holds, so no row can fail it, and that scan is gone. The cleanup swap that narrows the check, and the check created with a new column, still scan for rows that would fail them.

`@ez4/pgsql`: `alter().column(name).type(type, false)` changes a column's type without `USING`, leaving the conversion to Postgres' assignment cast. `type(type)` keeps emitting `USING "column"::type`.
