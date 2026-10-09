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
- **Pool:** one connection per function instance, closed after 5 minutes idle; keep the role's `idle_session_timeout` and the proxy's idle client timeout above that.
- **Retries:** opening a connection is retried while the database restarts or resumes. A statement whose session the server ended (`57P01`, `57P05`) runs again on a new connection, outside transactions only.
- **Timeouts:** the Data API cuts statements at 45 seconds; for native connections, set `statement_timeout` on the role.

## License

MIT License
