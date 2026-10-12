# EZ4: AWS Function

It provides all the components to manage lambda functions on AWS.

## Getting started

#### Install

```sh
npm install @ez4/aws-function -D
```

#### Permission

Ensure the user performing deployments has the permissions below:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "LambdaManagement",
      "Effect": "Allow",
      "Action": [
        "lambda:GetFunction",
        "lambda:CreateFunction",
        "lambda:DeleteFunction",
        "lambda:UpdateFunctionCode",
        "lambda:GetFunctionConfiguration",
        "lambda:UpdateFunctionConfiguration",
        "lambda:ListVersionsByFunction",
        "lambda:CreateAlias",
        "lambda:UpdateAlias",
        "lambda:PublishVersion",
        "lambda:AddPermission",
        "lambda:RemovePermission",
        "lambda:TagResource",
        "lambda:UntagResource",
        "lambda:PutFunctionConcurrency",
        "lambda:DeleteFunctionConcurrency"
      ],
      "Resource": ["arn:aws:lambda:*:{account-id}:function:{prefix}-*"]
    },
    {
      "Sid": "AuthorizeLambdaServices",
      "Effect": "Allow",
      "Action": ["iam:PassRole"],
      "Resource": ["arn:aws:iam::{account-id}:role/{prefix}-*"],
      "Condition": {
        "StringLike": {
          "iam:PassedToService": ["lambda.amazonaws.com"]
        }
      }
    }
  ]
}
```

#### Functions in a VPC

A function that needs a VPC (e.g. linked to a database through a native connection) runs in the default VPC:

- in the subnets tagged `ez4:functions` = `true`, or its first two subnets when none is tagged;
- with the security groups tagged `ez4:functions` = `true`, or its default security group when none is tagged.

Tag private subnets routed through a NAT to give those functions outbound access. The configuration in use is kept in the state, so a deploy after the tags change shows the move in the plan and reconfigures the functions.

#### Reserved concurrency

A function with `reservedConcurrency` (an HTTP route or route group declares it) has that many concurrent executions reserved: it never runs more at once, and the rest of the account can't take them. The deploy reserves it on creation and on the next deploy of an existing function, changes it without publishing a version, and removes the reservation once the option is taken out. A function that never declares it doesn't call the concurrency API, so only deployments that use the option need `lambda:PutFunctionConcurrency` and `lambda:DeleteFunctionConcurrency`.

## License

MIT License
