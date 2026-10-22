---
'@ez4/queue': minor
'@ez4/aws-queue': minor
'@ez4/local-queue': minor
---

A queue subscription declares `idempotency: { key, ttl }` to run its handler once per key, however many times the queue delivers the message. The key is one or more required message fields (checked against the message schema before deploying), and `ttl` is how long (in seconds) a key that ran keeps a repeated message out. A message whose key already ran is acknowledged without running the handler; one whose key is running in another execution goes back to the queue; a handler that fails or calls `retry` frees the key; a handler that throws `UnknownOutcomeError` (from `@ez4/queue/utils`) keeps it and the message is consumed. On AWS the keys live in a `<queue name>-claims` DynamoDB table with time to live, created with the first subscription that declares idempotency, and each message costs two conditional writes; the queue functions' policy can update and delete items of `*-claims` tables. A function without idempotency gets no new value in its function hash and never loads the DynamoDB client. The local emulator keeps the keys in memory with the same rules.
