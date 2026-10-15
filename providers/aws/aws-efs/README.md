# EZ4: AWS EFS

It provides all the components to manage Amazon Elastic File System (EFS) file systems, mount targets, and access points on AWS.

## Getting started

#### Install

```sh
npm install @ez4/aws-efs -D
```

#### Overview

This provider package manages Amazon EFS shared storage resources:

- **File System**: Declares and provisions EFS file systems (`aws:efs.filesystem`) with encrypted storage, lifecycle policies, and performance mode settings.
- **Mount Target**: Declares and attaches mount targets (`aws:efs.mount-target`) across VPC subnets and security groups.
- **Access Point**: Declares POSIX access points (`aws:efs.access-point`) with custom root directories, directory creation permissions, and POSIX user/group ownership (UID/GID) for secure container access.
- **Triggers**: State engine handlers that reconcile file systems, mount targets, and access points during deployment.

#### Permission

Ensure the user performing deployments has the permissions below:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "EfsManagement",
      "Effect": "Allow",
      "Action": [
        "elasticfilesystem:CreateFileSystem",
        "elasticfilesystem:DeleteFileSystem",
        "elasticfilesystem:DescribeFileSystems",
        "elasticfilesystem:CreateMountTarget",
        "elasticfilesystem:DeleteMountTarget",
        "elasticfilesystem:DescribeMountTargets",
        "elasticfilesystem:CreateAccessPoint",
        "elasticfilesystem:DeleteAccessPoint",
        "elasticfilesystem:DescribeAccessPoints",
        "elasticfilesystem:TagResource",
        "elasticfilesystem:UntagResource"
      ],
      "Resource": ["*"]
    }
  ]
}
```

## License

MIT License
