---
'@ez4/database': minor
'@ez4/aws-dynamodb': minor
---

`findOne`, `findMany` and `exists` take `consistent: false` on DynamoDB tables to read eventually consistent data, which
costs half of a strongly consistent read and may miss a write that finished a moment before. Reads stay strongly
consistent by default, and reads through a secondary index are eventual as before.

The option comes from the engine: `DynamoDbEngine` declares the new optional `eventualReadMode`, and an engine that
doesn't declare it (Postgres included) doesn't take `consistent` at all.
