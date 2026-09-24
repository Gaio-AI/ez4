---
'@ez4/queue': patch
'@ez4/aws-queue': patch
'@ez4/common': patch
---

A queue subscription can set `parallelism`, the number of messages one handler execution processes at the same time; the default, 1, keeps them one after another. Messages from the same group in a FIFO queue still run in order, each message logs and sends under its own request scope, a timeout is reported for every message in flight, and a message the invocation has no time left for goes back to the queue unstarted.
