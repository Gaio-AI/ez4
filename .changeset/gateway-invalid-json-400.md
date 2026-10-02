---
'@ez4/gateway': patch
'@ez4/aws-gateway': patch
'@ez4/local-gateway': patch
---

Answer a JSON request body or WebSocket message that doesn't parse with `400 Malformed body payload.` instead of a 500, and stop logging the raw body.
