# EZ4: AWS Secret

It provides all the components to manage AWS Secrets Manager secrets on AWS.

## Getting started

#### Install

```sh
npm install @ez4/aws-secret -D
```

#### Overview

This provider package manages AWS Secrets Manager secrets:

- **Secret**: Declares and provisions Secrets Manager secrets (`aws:secretsmanager.secret`). Secret values are written exclusively via `PutSecretValue` and never stored in state files. Secrets support retention on destroy (`retain: true`) to avoid accidental data loss.
- **Triggers**: State engine handlers that reconcile secret declarations during deployment.

#### Permission

Ensure the user performing deployments has the permissions below:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "SecretManagement",
      "Effect": "Allow",
      "Action": [
        "secretsmanager:CreateSecret",
        "secretsmanager:DeleteSecret",
        "secretsmanager:DescribeSecret",
        "secretsmanager:PutSecretValue",
        "secretsmanager:TagResource",
        "secretsmanager:UntagResource"
      ],
      "Resource": ["*"]
    }
  ]
}
```

## License

MIT License
