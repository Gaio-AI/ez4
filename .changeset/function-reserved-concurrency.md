---
'@ez4/gateway': minor
'@ez4/aws-gateway': minor
'@ez4/aws-function': minor
---

An HTTP route or route group can reserve concurrency for its function: `reservedConcurrency: 5` on the route (or on the group in the service `groups`) keeps that many concurrent executions for the function, which never runs more requests at once and can't take concurrency from the rest of the account. Metadata fails when the value isn't a positive integer, since zero would fail every request, and when a grouped route declares a value apart from its group. It isn't a service default, and an `Http.Import` keeps it out of the client.

The deploy calls `PutFunctionConcurrency` when the function is created or imported, and again when the value changes, without publishing a new version; taking the option out calls `DeleteFunctionConcurrency`. The plan shows the change on the function. A function that never declares it doesn't call the concurrency API, so its plan doesn't change and only deployments that use the option need `lambda:PutFunctionConcurrency` and `lambda:DeleteFunctionConcurrency` (see the `@ez4/aws-function` README).
