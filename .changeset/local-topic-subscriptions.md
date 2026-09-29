---
'@ez4/local-topic': patch
---

A `Topic.Import` keeps its subscription to the owning project's local emulator: it retries until the owner answers and renews every 15 seconds, so projects that start together or restart on their own no longer lose events. A failing Lambda subscription is retried twice, as SNS does with asynchronous invocations, instead of being dropped, including on imported topics, where the failure made the owner's request fail. Emulator traffic uses the `fetch` captured when the module loads, so a spec that stubs `globalThis.fetch` can't intercept it.
