---
'@ez4/project': patch
'@ez4/aws-gateway': patch
'@ez4/aws-queue': patch
'@ez4/aws-topic': patch
'@ez4/aws-scheduler': patch
'@ez4/aws-bucket': patch
'@ez4/aws-dynamodb': patch
'@ez4/local-gateway': patch
'@ez4/local-queue': patch
'@ez4/local-topic': patch
---

Add `enabled` to a project reference: a disabled reference still provides its types, each `Http.Import` of it skips the gateway lookup and gets a client that fails every operation with `503`, any other import of it fails the deploy, and switching it rebundles the functions using its imports.
