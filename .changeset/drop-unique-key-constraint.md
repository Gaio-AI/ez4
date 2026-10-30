---
'@ez4/pgmigration': patch
---

Dropping or replacing a unique index no longer fails on a database that holds that unique key as a constraint, as databases created by earlier versions do. Postgres refuses to drop the index of a constraint, so the cleanup now drops the constraint first when there is one (which takes its index with it), and the index drop that follows finds nothing. This covers a unique key that is removed, that changes type (to secondary or to primary) and that changes columns. Tables without such a constraint run the same statements as before.
