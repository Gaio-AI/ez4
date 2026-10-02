---
'@ez4/pgclient': patch
'@ez4/aws-aurora': patch
---

Keep the error that made a transaction fail, in `transaction()` and in `executeTransaction` of the local, native and Data API drivers. A `COMMIT` that fails is no longer followed by a rollback whose error replaced its own, and a unique key violated at commit (a deferred constraint) throws `DuplicateUniqueKeyError` as it does on a statement. When the rollback after a failed operation fails too, the operation's error is thrown with the rollback failure attached as `rollbackError`.
