---
'@ez4/common': patch
'@ez4/gateway': patch
'@ez4/aws-gateway': patch
'@ez4/aws-queue': patch
'@ez4/aws-topic': patch
'@ez4/aws-scheduler': patch
'@ez4/local-gateway': patch
'@ez4/local-queue': patch
'@ez4/local-topic': patch
'@ez4/local-scheduler': patch
---

`Http.Service` can declare `defaults.scope` and an `Http.Route` can declare `scope`, each a map of scope key to request header name. `Ws.Service` can declare `defaults.scope` too. The request, authorizer and WebSocket connect handlers read the declared headers into `Runtime.getScope()` next to `traceId`. The WebSocket handlers fall back to the query string parameter of the same name, and so does `x-trace-id`. Values are capped at 256 characters. With `cors`, the deployed `allowHeaders` gains `x-trace-id` and every declared header. The scope reaches every hop: the HTTP client sends it under the declared header names, queue and topic messages carry it in one `EZ4.SCOPE` attribute next to `EZ4.TRACE_ID`, and scheduler events carry it in the envelope. The local emulators now carry `traceId` and scope too. A message without the new payload restores `traceId` as before. Nothing changes for a service that declares no scope.

Behaviour changes for existing services:

- `Runtime.setScope` no longer seals the scope object.
- `x-trace-id` is always added to the CORS `allowHeaders`, so API Gateway updates on the next deploy of every service with `cors`.
- The local HTTP emulator now honours an incoming `x-trace-id`.
- Client trace ids (`x-trace-id`) are capped at 256 characters.
