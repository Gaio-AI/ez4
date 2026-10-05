---
'@ez4/aws-queue': patch
---

A standard queue declared with `fairMode` now sends its `groupId` as the `MessageGroupId` of every message. The
linked client was built with the FIFO options in place of the fair ones, so on AWS a fair queue sent no group at
all and SQS never applied fair queuing: one tenant's backlog still held every consumer.
