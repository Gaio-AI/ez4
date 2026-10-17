---
'@ez4/aws-common': minor
'@ez4/aws-ecs': patch
'@ez4/aws-ecr': patch
'@ez4/aws-efs': patch
'@ez4/aws-cloudmap': patch
'@ez4/aws-email': patch
'@ez4/aws-bucket': patch
---

`ez4 destroy` without `--force` no longer drops the entry of a resource it did not delete. The ECS cluster, service and task definition, the ECR repository, the EFS file system, mount target and access point, the Cloud Map namespace, the email identity and a bucket that still holds objects were skipped in silence and left the state, so they stayed in the account with nothing able to delete them, not even a later `destroy --force`. Each one now adds a warning that names it (`ECR repository 'x' was kept; deleting it needs --force.`) and stays in the state, as a log group with unexpired logs already did. `allowForcedDeletion` in `@ez4/aws-common` is the check. `aws-email` gains the `test:offline` script the other providers have.
