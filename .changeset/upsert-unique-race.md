---
'@ez4/pgclient': patch
---

An `upsertOne` that runs as one `INSERT … ON CONFLICT` statement runs it once more when it fails on a duplicate key. The conflict target arbitrates only its own unique index, so two upserts of the same record on a table with another unique index could collide on that index first, and the one that lost failed with `DuplicateUniqueKeyError` instead of updating the record the other one inserted. Inside a transaction the statement runs under a savepoint, so the retry doesn't meet an aborted transaction, and an upsert that still fails (a different record holds the other key) is undone on its own and leaves the transaction usable. The local Data API emulation also takes a rollback to a savepoint in an aborted transaction, as the Data API does.
