---
'@ez4/aws-aurora': patch
'@ez4/pgclient': patch
---

Classify Data API errors by their exact SQLState instead of by any occurrence of its digits in the message: an error whose text merely contains `23505`, `28P01` or `40P01` (an echoed id, a foreign key value) no longer becomes a `DuplicateUniqueKeyError`, an authentication retry or a deadlock retry. `DuplicateUniqueKeyError` now carries the original database error as `cause`.
