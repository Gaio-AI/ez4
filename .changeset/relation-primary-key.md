---
'@ez4/pgclient': patch
---

A relation between two primary keys, such as a table keyed by `account_id` with `'account_id@account': 'accounts:id'`, is written by the table that declares it, as the relation types and `update` already expect. An insert or upsert that connects it with `account: { id }` writes `account_id` into the record, where it used to leave the column to its default and then set `accounts.id` to that value, rewriting the related primary key. Creating the related record inline inserts it first and takes its key, and `upsertOne` on such a table is one `INSERT … ON CONFLICT` statement instead of the update followed by the insert.
