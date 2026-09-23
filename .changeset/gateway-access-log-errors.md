---
'@ez4/aws-gateway': patch
---

The HTTP stage access log also records `responseLatency`, `errorType` and `integrationServiceStatus`, so a request the gateway fails on its own can be told apart from a function error. The format is kept in the stage parameters: a stage that already logs picks up a new format on its next deploy.
