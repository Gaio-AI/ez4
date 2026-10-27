---
'@ez4/queue': minor
'@ez4/aws-queue': minor
'@ez4/aws-function': minor
---

A queue subscription can declare `recursiveLoop`, for a handler that sends to its own queue past the 16 deliveries Lambda's recursive loop detection lets one chain of requests make (past them, Lambda drops the message without an error). `true` sets the function's recursion config to `Allow`, `false` back to `Terminate`, on creation, on import and when the value changes; left out, the function keeps whatever it has, so a deploy of code that predates the option never undoes it and a function that never declares it needs no permission over the recursion config. Deploying a subscription that declares it needs `lambda:PutFunctionRecursionConfig`.
