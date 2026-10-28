---
'@ez4/pgmigration': patch
---

An index that changes its name and also how it is built (included columns, predicate, order) is no longer read as a rename of the index it replaces: the migration builds it under the new name and drops the old one. Before, a removed index paired with an added one of the same type and columns was renamed into its place, and the new options were never built. An index that only changes its name is still renamed.
