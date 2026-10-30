---
'@ez4/aws-dynamodb': patch
---

Stop logging as errors the statement failures that are a query's answer rather than a fault: the failed condition of an `updateOne` (a compare-and-set that lost, answered as `undefined`), the duplicate key of an `insertOne` and the failed condition of a `deleteOne`, both thrown for the caller to handle. Any other failure is still logged with its statement before it is thrown.
