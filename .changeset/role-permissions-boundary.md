---
'@ez4/project': minor
'@ez4/aws-identity': minor
---

`deployOptions.permissionsBoundary` names a customer managed policy of the deploy account that the deploy sets as the permissions boundary of every role it creates. A role that already exists, in the state or only in the account, gets it on the next deploy before any of its policies or its trust change, and loses it when the option goes. Without the option nothing changes in the plan. `RoleParameters` takes `permissionsBoundary` (an ARN), and `buildPolicyArn` joins `buildRoleArn`.
