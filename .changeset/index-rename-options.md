---
'@ez4/pgmigration': patch
---

A declared column rename no longer rebuilds an index that orders by the column, includes it or filters on it. The index
was compared with its options as they were before the rename, so it read as a different index and was built again
concurrently in the rollout, under a temporary name, while the old code ran against the renamed column. Now the
column moves with the rename in the order, the included columns and the where, as it already did in the key, and the
migration only renames the column.
