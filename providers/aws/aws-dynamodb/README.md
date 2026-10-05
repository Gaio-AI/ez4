# EZ4: AWS DynamoDB

It provides all the components to manage DynamoDB tables and streams on AWS.

## Getting started

#### Install

```sh
npm install @ez4/aws-dynamodb -D
```

#### Permission

Ensure the user performing deployments has the permissions below:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "DynamoDBManagement",
      "Effect": "Allow",
      "Action": [
        "dynamodb:CreateTable",
        "dynamodb:DescribeTable",
        "dynamodb:UpdateTable",
        "dynamodb:DeleteTable",
        "dynamodb:TagResource",
        "dynamodb:UntagResource",
        "dynamodb:DescribeTimeToLive",
        "dynamodb:UpdateTimeToLive",
        "dynamodb:UpdateContinuousBackups"
      ],
      "Resource": ["arn:aws:dynamodb:*:{account-id}:table/{prefix}-*"]
    }
  ]
}
```

#### Options

```ts
export declare class Db extends Database.Service<DynamoDbEngine> {
  options: {
    // Continuous backups of every table in the service, restorable to any second of the last 35 days.
    pointInTimeRecovery: true;
  };

  // ...
}
```

Point-in-time recovery is left alone on tables of a service that never declares it, so recovery turned on outside
ez4 stays on. Taking the option out of a service that declared it turns recovery off, and DynamoDB drops the restore
window with it.

## License

MIT License
