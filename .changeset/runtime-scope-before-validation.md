---
'@ez4/aws-topic': patch
'@ez4/aws-dynamodb': patch
---

A topic event or a DynamoDB stream record that fails validation is now reported under its own trace id. The runtime
scope outlives an invocation, and it used to be replaced only after validation, so the error went out with the trace
id of the previous invocation or record. A stream record that fails validation also no longer reports the previous
record's change as its request.

This changes the runtime code bundled into topic subscribers and stream handlers.
