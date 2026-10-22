---
'@ez4/encryption': minor
'@ez4/aws-kms': minor
'@ez4/local-encryption': minor
---

Add the Encryption contract (`Encryption.Service`, `Encryption.Import`) and its AWS KMS provider: one KMS key per service with yearly rotation, envelope encryption with a data key drawn once per client and kept in memory, values bound to an optional context, and a policy for the project's functions scoped by the key's alias. `@ez4/local-encryption` emulates both locally with a fixed key, so serving and testing need no AWS account.
