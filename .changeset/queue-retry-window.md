---
'@ez4/aws-queue': minor
---

A queue that declares no backoff spreads its retries over at least 10 minutes: the first retry still comes after 5 to 30 seconds, and the last attempt only runs once the window has gone by, so a database restart or failover no longer sends its messages to the dead-letter queue. A declared backoff keeps its own delays. Only queue functions change: the schedule lives in the queue runtime, so adopting the version leaves the bundles of every other function byte for byte.
