---
'@ez4/common': patch
---

Service wrappers log a caught error at the level its status calls for, through `Runtime.reportError`. A client error is the service working as designed: an HTTP 400 is logged as a warning, any other 4xx as information, and only a 5xx or an error with no status stays an error. This covers the HTTP route, where a handler error mapped through `httpErrors` counts with its mapped status, and the authorizer and the WebSocket connection. Before, every rejected request, from a validation failure to an expired token, was an error.

The logged error no longer carries the value that failed validation. `context.details[].input` held whatever the client sent, including the rejected body, and went to the log with it. The thrown error is left untouched.

An error marked with `LOGGED_ERROR`, a registered symbol (`Symbol.for('@ez4/logged-error')`), is not logged again. It is meant for application errors that log themselves where they are raised, so each failure is logged once instead of twice.
