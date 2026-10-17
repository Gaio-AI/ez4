---
'@ez4/queue': minor
'@ez4/aws-queue': minor
'@ez4/local-queue': minor
---

A queue subscription can set `acknowledge: 'batch'` to leave every delete to the event source mapping: the runtime no longer deletes each message of a longer batch as soon as it's handled, and returns the messages that failed or were handed back as batch item failures, so the mapping deletes the rest together once the invocation returns. It saves a delete request per message, but an invocation that dies or fails after some messages ran gets the whole batch back and runs them again, so it's only for idempotent handlers. The default, `acknowledge: 'record'`, keeps deleting each message as it's handled. The local queue follows the same rule, and `acknowledge` is part of the function hash, so the first deploy with this version updates every queue function.

A FIFO subscription with a `batch` above 10, which SQS refuses at deploy, is now a metadata error. The `parallelism` docs say that it overlaps only work that doesn't share a connection.
