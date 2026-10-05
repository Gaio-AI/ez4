---
'@ez4/aws-queue': patch
---

Importing a queue no longer removes the owner queue's dead-letter queue. Creating a `Queue.Import` called the queue update with the import's own attributes, which are none, and since every update sends an empty `RedrivePolicy` when no dead letter is declared, the first deploy of a project that started importing a queue took the redrive policy off the owner's queue. The owner never noticed: its state still listed the dead letter, so its next deploy saw no change and did not put it back. An import now only resolves the queue URL and leaves every attribute to the project that owns the queue.
