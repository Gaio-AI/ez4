---
'@ez4/pgmigration': patch
---

The deploy plan says when a statement that its check usually skips runs. Every index the migration builds comes after a `DROP INDEX CONCURRENTLY IF EXISTS` of the same name, which only runs to rebuild an index left invalid by an earlier build, and the plan now prints it as `DROP INDEX CONCURRENTLY IF EXISTS "<index>" -- only when the index is invalid`. Without it, declaring an index that already exists listed a drop of that index in the plan. A statement carries the text in `condition`.
