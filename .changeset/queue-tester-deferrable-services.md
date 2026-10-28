---
'@ez4/local-queue': patch
---

`QueueTester` takes a standard queue whose handler declares `Queue.DeferrableIncoming` as its type argument (`QueueTester.incoming<MyQueue>(…)`), which its `Queue.Mode` constraint refused with TS2344; the queues are now constrained with their mode left open, as the contract's own constraints are. `QueueTester.ClientMode` also tells a FIFO queue apart again, so the client a tester returns for one is typed in FIFO mode instead of fair mode: a spec that sends to a FIFO queue's client with options only a standard queue takes now fails to compile.
