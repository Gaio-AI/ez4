---
'@ez4/queue': minor
'@ez4/aws-queue': minor
'@ez4/local-queue': minor
---

A queue handler puts a message off with `request.defer({ delay })` without spending an attempt: a copy goes back to the queue with the delay (a delay above 900 seconds is made of waits of 900, the copy coming back early and waiting again without running the handler) and the delivery is consumed, so a provider's rate limit or quota no longer walks the message toward the dead-letter queue. A message is deferred at most 20 times, each wait counting once, after which it fails like with an error; a message of a FIFO queue can't be deferred. A subscription declares `keyConcurrency: { key, max }` to run at most `max` messages with the same key at once across all its executions: a message whose key has no free slot waits 5 to 30 seconds as a deferred copy, without spending an attempt. Slots live in the `<queue name>-claims` table with the idempotency keys and free themselves after the queue timeout; FIFO queues don't take it. `MaxDeferCount`, `MaxDeferDelay`, `getConcurrencySlotKey` and `getSlotWaitDelay` are in `@ez4/queue/utils`, and the tester's incoming request records `defer` calls. The local emulator follows the same rules.
