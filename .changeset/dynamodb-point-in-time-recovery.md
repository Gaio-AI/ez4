---
'@ez4/aws-dynamodb': minor
---

A DynamoDB service can keep point-in-time recovery on its tables: `options: { pointInTimeRecovery: true }` turns on continuous backups for every table of the service, restorable to any second of the last 35 days. The deploy turns them on when the table is created, retrying while DynamoDB is still getting the new table ready for backups, and on the next deploy of an existing table. Taking the option out turns recovery off, and DynamoDB drops the restore window with it.

A service that never declares the option leaves recovery alone, so tables where it was turned on outside ez4 keep it, and their plan does not change. The deploy needs `dynamodb:UpdateContinuousBackups` on the tables (see the README).

`DynamoDbEngine` is now re-exported as a type, which it always was, so the source loads where types are stripped.
