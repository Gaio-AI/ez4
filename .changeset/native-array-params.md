---
'@ez4/pgsql': minor
'@ez4/pgclient': minor
---

Native connections bind a list as one Postgres array. `isIn` on a scalar column sends `"id" = ANY($1::uuid[])` instead of one parameter per value, so the statement keeps the same text and size for any list (an RDS Proxy pins the session of a statement longer than 16 KB). A raw query binds a list as one array where it casts the parameter to an array type (`WHERE id = ANY(:ids::uuid[])`); a list cast to `jsonb` keeps its JSON binding. The Data API and its local emulation keep one parameter per value. `SqlBuilder` takes `onPrepareArray`, and `PgClientDriver` an optional `prepareArrayVariable`.
