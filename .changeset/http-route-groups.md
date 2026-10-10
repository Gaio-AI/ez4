---
'@ez4/gateway': minor
'@ez4/aws-gateway': minor
'@ez4/aws-common': minor
'@ez4/aws-function': minor
'@ez4/project': minor
'@ez4/aws-queue': minor
'@ez4/aws-topic': minor
'@ez4/aws-scheduler': minor
'@ez4/aws-bucket': minor
'@ez4/aws-dynamodb': minor
---

HTTP routes can share one function through a route group, and the project sets the Lambda system log level:

- **Route groups:** a route with `group: 'name'` is served by the function `<service>-group-<name>` instead of a function of its own. All routes of a group share that function, its log group, permission and integration, so moving n routes to a group plans 4 resources created, n routes updated and 4n deleted. The function picks the route by the request's route key and keeps each route's validation, response, `httpErrors`, `preferences` and `scope`; each route's settings are parsed on its first request. A route key the group doesn't serve answers `404` and logs an error. `Http.Incoming` carries the matched `routeKey` in a group.
- **Group settings:** the optional `groups: { name: { ... } }` of `Http.Service` sets the group's `memory`, `timeout`, `architecture`, `runtime`, `logRetention`, `logLevel`, `debug`, `files`, `vpc` and `listener`, over the service `defaults`. Metadata fails when a grouped route declares one of them apart from its group, when two routes of a group give a variable different values, when a group's function name is longer than 64 characters or is taken by another function of the service, and when `groups` names a group no route uses. The deploy fails when a grouped handler needs a VPC through its context and its group doesn't set `vpc: true`. An `Http.Import` reads `group` as the owner's deployment and keeps it out of the client.
- **Moving a route without errors:** a route update that points the route to another integration (into or out of a group, or to a renamed handler) waits for every auto deployed stage to serve the new deployment, and then for the stage to settle, before the deploy goes on. The prior integration, its permission and its function are deleted only after that, so requests no longer fail with `500` while the stage still sends some of them to the prior integration. Each such update takes about 20 seconds longer.
- **Nothing changes without a group:** a route with no `group` plans the same resources, hashes and bundle bytes as before, so taking this version uploads no code.
- **System log level:** `defaultOptions.systemLogLevel` sets the `SystemLogLevel` of every function the project deploys (`information` shows the `REPORT` lines with the init duration). It stays `WARN` when not set, and platform lines have no error level.
