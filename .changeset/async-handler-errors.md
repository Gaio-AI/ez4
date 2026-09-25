---
'@ez4/aws-function': patch
'@ez4/aws-scheduler': patch
'@ez4/aws-topic': patch
'@ez4/aws-bucket': patch
---

A handler that fails in a schedule, topic subscription or bucket event now fails its invocation, after the service's error event, so it counts in the function's errors. Topic and bucket events get the retries of the asynchronous invocation; schedule targets are deployed with no asynchronous retries, so a failed run doesn't run again. Deploying a schedule target sets that on its alias with `lambda:PutFunctionEventInvokeConfig`, which the deploy identity now needs.
