---
'@ez4/pgmigration': patch
---

The integrity check retries a failed validation only while another session is still running a statement on the same index or constraint. The query that looks for that statement matched itself, since its own text carries the name it searches for, so every failed validation read as still running and went through all 25 attempts, 7 to 13 minutes, before the failure was reported. The session running the query is now left out: a validation that failed for good fails at once, and a `CREATE INDEX CONCURRENTLY` or an `ALTER TABLE ... VALIDATE CONSTRAINT` still in progress is still waited for.
