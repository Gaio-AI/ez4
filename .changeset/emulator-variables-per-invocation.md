---
'@ez4/project': patch
---

Local invocations keep their variables to themselves. `serve`, `test` and `run` used to write each invocation's variables into the process-wide `process.env` while it ran, so concurrent handlers read each other's values: a variable one handler declared was visible to another that didn't, and the same logical name mapped to different values mixed between them. `process.env` now answers each read from the invocation making it, and a service invoked inside another one sees the outer variables too, as it does on AWS. The new `serveOptions.strictVariables` goes further, as the Lambda does: a handler reads only the variables it declares, the runtime ones (`AWS_*`, `LAMBDA_*`, `NODE_*`, `TZ`, `LANG`, `PATH` and the like) and the `serveOptions.allowedVariables`. The rest of the process environment, such as every secret a `doppler run` loaded, reads as `undefined`, with a warning the first time each one is hidden.
