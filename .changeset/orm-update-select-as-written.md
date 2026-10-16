---
'@ez4/database': major
'@ez4/pgclient': major
'@ez4/aws-dynamodb': major
---

The `select` of `updateOne`, `updateMany` and `upsertOne` returns each record as the write left it, instead of as it was before. On Postgres an update with `select` is one `UPDATE … RETURNING`: it reports exactly the records it changed, so it works as a compare-and-set, and it no longer joins every updated row with every selected one (an `updateMany` with `select` grew with the square of the rows). When the update also rewrites a relation held by another table and selects relations, the records are read again by primary key after the write. On DynamoDB the update returns `ALL NEW`, and `updateMany`, whose write is a transaction, reads the records again by key.

`previous: true` keeps the old answer: the records as they were before the write. On Postgres the records are read and locked in primary key order and the update writes those records and no other, so concurrent updates each report what they overwrote. It needs a primary index (`MissingPrimaryIndexError`). On DynamoDB it returns `ALL OLD`.

A unique-to-unique relation is (re)connected or disconnected through the foreign key of the table that declares it, which is where the migration puts it. It used to rewrite the unique key of the related records, so disconnecting cleared that key and connecting left the relation empty.

Breaking: a call that reads, from the `select` of `updateOne`, `updateMany` or `upsertOne`, a field the same call writes and relies on the value before the write must add `previous: true`.
