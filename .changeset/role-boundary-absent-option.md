---
'@ez4/project': patch
'@ez4/aws-identity': patch
---

A deploy without `deployOptions.permissionsBoundary` leaves a role's boundary as it is, and plans no change for it, instead of taking it off. A deploy from code that predates the option, such as a branch cut before it, no longer needs `iam:DeleteRolePermissionsBoundary`, which a boundary is there to keep from deployers.
