---
'@ez4/docs-gateway': minor
'@ez4/gateway': minor
---

Generate an OpenAPI document that states the contract the gateway enforces:

- A nullable property (`| null`) stays required unless it's also optional, and its schema takes `null`. A nullable header, path parameter or query string is required unless it's optional, since its value is never null.
- The headers a handler response declares are the response headers of its success statuses.
- A `@throws <status> [description]` in the handler JSDoc documents an `HttpError` the handler raises, with the `HttpError` body, next to the gateway's own body when the gateway answers the same status. It changes nothing at runtime.

A document generated again lists more properties as required, so a breaking-change check over it (`oasdiff breaking`) can report request properties that became required: the gateway already refused them missing.
