---
'@ez4/project': patch
'@ez4/local-gateway': patch
'@ez4/local-queue': patch
'@ez4/local-scheduler': patch
'@ez4/local-topic': patch
---

Tests can run a service through its local pipeline with client overrides that hold for that one invocation. `Tester.request(resourceName, request, { services })` hands the emulator a request the way `ez4 serve` does and resolves with `{ status, headers, body }`; the clients in `services`, by resource name, take the place of the real or mocked ones for whatever runs in the async context of the call, so a concurrent request or another spec never sees them. `HttpTester.request`, `TopicTester.publish`, `CronTester.trigger` and `QueueTester.send` wrap it with parameters typed from the service contract. `HttpTester.request` parses a JSON response body and, given an `identity`, calls a route behind an authorizer without running the authorizer, checking the identity against the identity schema of the route. A local queue runs its batches in the context its poller started in, as production does, so a consumer never sees the overrides of the request that sent the message, nor any other async context of the sender. To call a handler directly, `QueueTester.incoming`, `TopicTester.incoming` and `CronTester.incoming` make the request the runtime gives it, with the message or event through the schema, so an invalid one throws the runtime's error, and `Tester.getContext` makes the context of a service with its real clients and the given overrides, typed as the handler's context through `QueueTester.getContext`, `TopicTester.getContext`, `CronTester.getContext` and `HttpTester.getContext`.
