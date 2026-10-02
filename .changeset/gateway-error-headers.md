---
'@ez4/gateway': patch
'@ez4/aws-gateway': patch
'@ez4/local-gateway': patch
---

Let an `HttpError` carry response headers (e.g. `retry-after`) that the error response includes, and add `HttpTooManyRequestsError` (429).
