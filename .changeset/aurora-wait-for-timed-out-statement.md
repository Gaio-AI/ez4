---
'@ez4/aws-aurora': patch
---

A migration statement that outlasts the 45 s of a Data API call is waited for before the next one runs. The Data API stops waiting while the database keeps running the statement, and the migration used to send the next one right away. Two concurrent index builds on the same table then ran together: the second waited for the table lock the first held, the first waited for the second's snapshot to end, and Postgres broke the deadlock by aborting one build, which left its index invalid. The integrity check then failed the deploy, and every retry did the same. A migration creating two or more indexes on a large table never got through.

The migration now waits while the statement shows in `pg_stat_activity`, for up to about two hours. If it is still running then, the migration fails with `MigrationStatementRunningError` and runs none of the statements after it.
