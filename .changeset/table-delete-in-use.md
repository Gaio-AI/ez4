---
'@ez4/aws-dynamodb': patch
---

Deleting a table waits while DynamoDB still has it in use from an earlier change, such as a stream being turned on or off, instead of failing the deploy on the first `ResourceInUseException`.
