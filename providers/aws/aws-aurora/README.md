# EZ4: AWS Aurora

It provides all the components to manage Aurora serverless v2 on AWS.

## Getting started

#### Install

```sh
npm install @ez4/aws-aurora -D
```

#### Permission

Ensure the user performing deployments has the permissions below:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AuroraClusterManagement",
      "Effect": "Allow",
      "Action": [
        "rds:CreateDBCluster",
        "rds:DescribeDBClusters",
        "rds:ModifyDBCluster",
        "rds:DeleteDBCluster",
        "rds:DisableHttpEndpoint",
        "rds:EnableHttpEndpoint",
        "rds:CreateDBInstance",
        "rds:DescribeDBInstances",
        "rds:ModifyDBInstance",
        "rds:DeleteDBInstance",
        "rds:AddTagsToResource",
        "rds:RemoveTagsFromResource"
      ],
      "Resource": [
        "arn:aws:rds:*:{account-id}:cluster:{prefix}-*",
        "arn:aws:rds:*:{account-id}:db:{prefix}-*"
      ]
    },
    {
      "Sid": "AuroraProxyDiscovery",
      "Effect": "Allow",
      "Action": ["rds:DescribeDBProxies"],
      "Resource": ["arn:aws:rds:*:{account-id}:db-proxy:*"]
    },
    {
      "Sid": "AuroraDatabaseManagement",
      "Effect": "Allow",
      "Action": [
        "rds-data:BeginTransaction",
        "rds-data:CommitTransaction",
        "rds-data:ExecuteStatement",
        "rds-data:RollbackTransaction"
      ],
      "Resource": ["arn:aws:rds:*:{account-id}:cluster:{prefix}-*"]
    },
    {
      "Sid": "AuroraSecretManagement",
      "Effect": "Allow",
      "Action": [
        "secretsmanager:CreateSecret",
        "secretsmanager:GetSecretValue",
        "secretsmanager:RotateSecret",
        "secretsmanager:TagResource"
      ],
      "Resource": ["arn:aws:secretsmanager:*:{account-id}:secret:rds!*"]
    },
    {
      "Sid": "AuroraKeyManagement",
      "Effect": "Allow",
      "Action": ["kms:DescribeKey"],
      "Resource": ["arn:aws:kms:*:{account-id}:key/*"]
    },
    {
      "Sid": "AuroraLinkRole",
      "Action": "iam:CreateServiceLinkedRole",
      "Effect": "Allow",
      "Resource": ["arn:aws:iam::*:role/aws-service-role/rds.amazonaws.com/AWSServiceRoleForRDS"],
      "Condition": {
        "StringLike": {
          "iam:AWSServiceName": "rds.amazonaws.com"
        }
      }
    }
  ]
}
```

## Master secret

The execution policy of a project that has an Aurora database reads only the master secrets of the project's own clusters, matched by the `aws:rds:primaryDBClusterArn` tag RDS puts on each (the `aws:ResourceTag` condition key, which the IAM policy simulator evaluates too). That holds for the Data API as well, which reads the secret with the caller's permission. Without it, a function in one stage could read another stage's master secret and, from inside the VPC, sign in to that stage's cluster.

## Native connections

By default a function reaches the database through the Data API. A link can connect natively instead, with the Postgres protocol, which needs the function in a VPC (see `@ez4/aws-function`):

```ts
declare class Handler extends Queue.Service<Message> {
  services: {
    db: Environment.Service<Db, { connectionMode: 'native'; user: 'app' }>;
  };
}
```

- **Authentication:** with `user`, the connection signs in with IAM: a token per connection, no secret. The database role needs `GRANT rds_iam TO <user>`. The deploy turns IAM database authentication on in the cluster (the cluster stays available and keeps its connections) and never turns it off, since a proxy or a person may sign in with it. Without `user`, it signs in with the cluster's master secret.
- **Proxy:** when an RDS Proxy named after the cluster exists and is available, the connection goes through it; otherwise it goes to the writer. Creating the proxy is how a stage opts in. Its endpoint reaches the function as the variable `EZ4_AURORA_PROXY_<CLUSTER>` (e.g. `EZ4_AURORA_PROXY_PRD_CONSOLE_DB`), so the deploy after the proxy appears or goes away shows the variable in the plan and switches the functions.
- **IAM grant:** the execution policy grants `rds-db:connect` on the clusters the project links natively and on their proxies, by resource id. A cluster created in the same deploy has no id yet, so its grant comes with the next deploy. Looking proxies up needs the `AuroraProxyDiscovery` permission above, only for projects with native links.
- **TLS:** always on, trusting the public roots (an RDS Proxy) and the RDS certificate bundle (the cluster itself).
- **Results:** raw queries return the shapes the Data API returns (numbers for `bigint` and `numeric`, UTC text for timestamps, text for `date` and `time`), so a link moves between the two modes without changing its queries. The Data API's statement timeout, result size limit and refused types don't apply.
- **Lists:** `isIn` on a scalar column binds its list as one array (`"id" = ANY($1::uuid[])`), so the statement keeps the same text and size for any list length; the Data API has no array parameters and gets one parameter per value. A raw query binds a list as one array where it casts the parameter to an array type (`WHERE id = ANY(:ids::uuid[])`); elsewhere a list stays JSON (`:ids::jsonb`), as with the Data API. An RDS Proxy pins the session of a statement longer than 16 KB, which a list of one parameter per value reaches at about a thousand values.
- **Pool:** one connection per function instance, closed after 5 minutes idle; keep the role's `idle_session_timeout` and the proxy's idle client timeout above that. The idle timer doesn't run while the function is frozen, so a connection idle for longer than that by the wall clock is discarded when it's next taken.
- **Retries:** opening a connection is retried while the database restarts, resumes or takes longer than the connection timeout. A statement whose session the server ended (`57P01`, `57P05`) runs again on a new connection, outside transactions only.
- **Timeouts:** the Data API cuts statements at 45 seconds; for native connections, set `statement_timeout` on the role.

## License

MIT License
