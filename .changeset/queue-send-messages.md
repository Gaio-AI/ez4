---
'@ez4/queue': minor
'@ez4/aws-queue': minor
'@ez4/local-queue': minor
---

The queue client sends a list of messages with `sendMessages`, in as few requests as SQS takes (up to 10 messages and 1 MiB each), so a fan-out of thousands of messages costs a tenth of the requests and of the CPU spent signing them. A standard queue sends up to 10 requests at once; a fifo queue sends one at a time, keeping the order of each group. Each message succeeds or fails on its own, as with `sendMessage`: a message the schema refuses or SQS rejects leaves the others to go, a message SQS failed on its side is sent once more right after its request (in a fifo queue, after the rest of that request), and then a `SendMessagesError` (from `@ez4/queue/utils`) lists each failed message with its index and reason. The local emulator, the import client and the tester mock send each message in order with the same failure report, and the tester tracks `sendMessages`.
