# EZ4: AWS ECS

It provides all the components to manage Amazon Elastic Container Service (ECS) clusters, task definitions, services, and standalone tasks on AWS.

## Getting started

#### Install

```sh
npm install @ez4/aws-ecs -D
```

#### Overview

This provider package manages AWS ECS Fargate resources and standalone task executions:

- **Cluster**: Declares and provisions ECS clusters (`aws:ecs.cluster`).
- **Task Definition**: Declares Fargate task definitions (`aws:ecs.taskdef`) with support for container definitions, environment variables, Secrets Manager secret injections, log configurations, IAM execution and task roles, and EFS volume mounts (`volumes` with `efs: { fileSystemId, accessPointId }` and `mountPoints`).
- **Service**: Deploys and reconciles long-running ECS Fargate services (`aws:ecs.service`) with network configuration (subnets, security groups) and Cloud Map service discovery integration.
- **Task Client**: Programmatic client routines (`runEcsTask`, `stopEcsTask`, `describeEcsTasks`) for executing and inspecting standalone Fargate tasks.
- **Triggers**: State engine handlers that reconcile ECS clusters, task definitions, and services during deployment.

#### Permission

Ensure the user performing deployments has the permissions below:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "EcsManagement",
      "Effect": "Allow",
      "Action": [
        "ecs:CreateCluster",
        "ecs:DeleteCluster",
        "ecs:DescribeClusters",
        "ecs:RegisterTaskDefinition",
        "ecs:DeregisterTaskDefinition",
        "ecs:DescribeTaskDefinition",
        "ecs:CreateService",
        "ecs:UpdateService",
        "ecs:DeleteService",
        "ecs:DescribeServices",
        "ecs:RunTask",
        "ecs:StopTask",
        "ecs:DescribeTasks",
        "iam:PassRole"
      ],
      "Resource": ["*"]
    }
  ]
}
```

## License

MIT License
