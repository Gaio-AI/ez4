---
'@ez4/pgclient': patch
---

`updateMany` and `deleteMany` honor `take` on Postgres: they write at most that many of the records the `where` matches. The type accepted `take` and the statement ignored it, so a batch delete removed every matching record. The page of keys is read first and the statement applies the `where` again to its records, so one that another write changed meanwhile and no longer matches is left alone; it needs a primary index (`MissingPrimaryIndexError`).
