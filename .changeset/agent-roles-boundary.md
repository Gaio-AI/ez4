---
'@ez4/aws-agent': minor
'@ez4/aws-identity': minor
---

Set the project's `permissionsBoundary` on every role an agent deploy creates: the task role of each agent, the shared execution role, the dispatcher role and each workflow role. Until now only the project's execution role got it, so a project with agents had roles outside its boundary. A deploy without the option still leaves each role's boundary as it is. `@ez4/aws-identity` exports `buildPermissionsBoundaryArn`, which both packages use to build the boundary ARN.
