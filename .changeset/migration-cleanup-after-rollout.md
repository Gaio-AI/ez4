---
'@ez4/state': patch
'@ez4/aws-aurora': patch
---

Run the Aurora migration cleanup (dropped columns, tables, indexes and constraints) only when every entry depending on the migration succeeded, the integrity check and the code switch of the functions using the database included; otherwise the migration stays partial and the next deploy runs the cleanup. A post action can now require its dependents with `postAction(callback, { requireDependents: true })`.
