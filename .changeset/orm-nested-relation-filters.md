---
'@ez4/database': minor
'@ez4/pgclient': minor
---

A relation filter takes the related table's own relations, at any depth: `where: { contact: { status: 'ready', person: { is_blocked: false } } }` renders one `EXISTS` per level, and `null` (no related record), `{}` (some related record), `NOT`, `AND` and `OR` work at every level. The `where` of an `include` takes the same relation filters. Each `EXISTS` subquery gets its own alias (`T0`, `T1`, …) instead of the shared `"T"`, so an inner level binds to the level above it. `RelationMetadata['filters']` now holds, per relation, the related table schema and its own relation filters (`RelationFilter`).
