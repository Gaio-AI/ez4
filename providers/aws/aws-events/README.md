# EZ4: AWS Events

It provides all the components to manage Amazon EventBridge event rules and targets on AWS.

## Getting started

#### Install

```sh
npm install @ez4/aws-events -D
```

#### Overview

This provider package manages EventBridge event routing and scheduled rules:

- **Rule**: Declares and provisions EventBridge rules (`aws:events.rule`) matching custom event patterns or running on cron / rate schedule expressions.
- **Targets**: Attaches Lambda function targets with automated resource-based permission statements (`AddPermission` / `RemovePermission`).
- **Triggers**: State engine handlers that reconcile EventBridge rules and target attachments during deployment.

#### Permission

Ensure the user performing deployments has the permissions below:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "EventsManagement",
      "Effect": "Allow",
      "Action": [
        "events:PutRule",
        "events:DeleteRule",
        "events:DescribeRule",
        "events:PutTargets",
        "events:RemoveTargets",
        "events:ListTargetsByRule",
        "lambda:AddPermission",
        "lambda:RemovePermission"
      ],
      "Resource": ["*"]
    }
  ]
}
```

## License

MIT License
