---
'@ez4/pgmigration': patch
'@ez4/project': patch
---

A table is only taken for the rename of a removed one when it keeps at least half of that table's columns. Before, any two tables whose names shared a word and that shared one column name (`id`, `created_at`) were planned as a rename, so a deploy that dropped `workflow_events` and added `attendance_events` in the same plan renamed the first into the second and altered its columns instead of dropping one and creating the other. The deploy plan also names a renamed table by its previous name when it reports what changes inside it, where it used to stop with `Cannot read properties of undefined (reading 'name')`.
