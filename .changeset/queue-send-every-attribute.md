---
'@ez4/aws-queue': patch
---

A queue attribute taken out of the code goes back to its default in AWS. SQS keeps the value of an attribute a request leaves out, and the deploy only sent the declared ones, so removing `delay` or `polling` from a queue left the old value in AWS while the plan showed nothing. Now every queue, dead-letter queues included, gets `delay` and `polling` with their defaults (0) when they are not declared, so the state holds the value AWS should have, the plan shows the change and the update sends it. Removing `deadLetter` from a queue now removes its redrive policy too (an empty `RedrivePolicy`), where it used to stay.

Deploying this version updates every queue whose state has no `delay` or `polling` once, to the values those queues already have unless something changed them outside the code.
