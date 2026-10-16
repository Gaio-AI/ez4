---
'@ez4/state': minor
'@ez4/aws-identity': minor
'@ez4/aws-agent': patch
---

A `preview` receives `getDependencies` in its step options: the dependencies of the entry being planned, with the result they have in the current state and none for the ones the plan creates or replaces. An IAM policy whose document is only known at apply (`getPolicyDocument`, as the agents' task policies that grant their workspace file system) resolves it at plan time with them and compares it to the stored `resolvedDocument`, so it shows up as changed only when its document did, instead of in every plan with `policyDocument = true`. When a dependency has no result yet the policy keeps being previewed as changed. `getPolicyDocument` takes a `PolicyContext` (`force` and `getDependencies`).
