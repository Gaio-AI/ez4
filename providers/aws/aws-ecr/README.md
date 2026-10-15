# EZ4: AWS ECR

It provides all the components to manage Amazon Elastic Container Registry (ECR) repositories and container images on AWS.

## Getting started

#### Install

```sh
npm install @ez4/aws-ecr -D
```

#### Overview

This provider package manages container registries and images as state resources in the EZ4 deployment lifecycle:

- **Repository**: Declares and provisions ECR repositories with image scanning configuration, lifecycle policies, and deletion safety (`aws:ecr.repository`).
- **Image**: Builds Docker images locally using `docker buildx` and pushes them to target ECR repositories with content-hashed tags (`aws:ecr.image`).
- **Triggers**: State engine handlers that reconcile repository and image state entries during deploy and destroy operations.

#### Permission

Ensure the user performing deployments has the permissions below:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "EcrManagement",
      "Effect": "Allow",
      "Action": [
        "ecr:GetAuthorizationToken",
        "ecr:CreateRepository",
        "ecr:DeleteRepository",
        "ecr:DescribeRepositories",
        "ecr:DescribeImages",
        "ecr:PutImageScanningConfiguration",
        "ecr:PutLifecyclePolicy",
        "ecr:BatchCheckLayerAvailability",
        "ecr:GetDownloadUrlForLayer",
        "ecr:BatchGetImage",
        "ecr:PutImage",
        "ecr:InitiateLayerUpload",
        "ecr:UploadLayerPart",
        "ecr:CompleteLayerUpload"
      ],
      "Resource": ["*"]
    }
  ]
}
```

## License

MIT License
