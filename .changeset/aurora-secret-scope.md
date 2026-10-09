---
'@ez4/aws-aurora': minor
'@ez4/aws-identity': minor
'@ez4/project': minor
---

The execution policy of a project with an Aurora database reads only the master secrets of the project's own clusters:

- **`@ez4/aws-aurora`:** `secretsmanager:GetSecretValue` on `rds!*` now carries an `aws:ResourceTag` condition on the tag RDS puts on every managed master secret, `aws:rds:primaryDBClusterArn`, matching the project's clusters (`cluster:<prefix>-*`, the same pattern as the Data API grant, branch or not). Before, every function of such a project could read every master secret in the account, including other stages'. From inside the VPC, next to a native link, that is a sign-in to another stage's database. The Data API reads the secret with the caller's permission, so its calls are held to the same clusters, which is what they already reach. The deploy publishes a new version of each project's Aurora policy.
- **`@ez4/project`:** `IdentityGrant` takes optional `conditions`, by operator and key as in an IAM policy.
- **`@ez4/aws-identity`:** `createPolicyDocument` writes a grant's `conditions` as the statement's `Condition`.
