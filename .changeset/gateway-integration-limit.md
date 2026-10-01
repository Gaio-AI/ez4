---
'@ez4/aws-gateway': patch
---

An HTTP API takes at most 300 integrations in API Gateway, one per route handler, and AWS does not raise that quota. A deploy that crossed it failed halfway through the apply. Now the deploy counts the integrations of each HTTP API while it prepares the resources, before the plan: from 280 on it warns with the count, and over 300 it stops with `IntegrationLimitError` naming the API, before anything is applied. WebSocket APIs are left out, since their quota can be raised.
