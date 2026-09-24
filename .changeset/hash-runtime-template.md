---
'@ez4/aws-common': patch
---

A function's source hash also covers the runtime template its provider wraps around the handler — queue, HTTP and WebSocket integrations, authorizers, topic subscriptions, schedules, table streams and bucket events. A change to a template now redeploys every function it runs in; before, it only reached the functions rebundled for another reason. The first deploy on this version plans every such function as changed, and only the bundles that actually differ are uploaded.
