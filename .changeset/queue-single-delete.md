---
'@ez4/aws-queue': patch
---

A queue handler invoked with a single record no longer deletes it itself: the event source mapping already deletes every record the batch response doesn't report, so each message was deleted twice. Batches of more than one record still delete each record once it's handled. An error raised outside the records, such as in the listener's `begin` event, now fails the invocation instead of returning no batch response, which made the event source mapping delete records that never ran.
