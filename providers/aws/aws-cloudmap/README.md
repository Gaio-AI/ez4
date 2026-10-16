# EZ4: AWS Cloud Map

It provides all the components to manage AWS Cloud Map (Service Discovery) namespaces and services on AWS.

## Getting started

#### Install

```sh
npm install @ez4/aws-cloudmap -D
```

#### Overview

This provider package manages private DNS service discovery resources:

- **Namespace**: Declares and provisions private DNS namespaces (`aws:servicediscovery.namespace`) associated with a VPC, enabling internal service name resolution.
- **Service**: Manages discovery services registered under a namespace with DNS records (such as A and SRV records).
- **Triggers**: State engine handlers that reconcile Cloud Map namespaces and services during deployment.

#### Permission

Ensure the user performing deployments has the permissions below:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "CloudMapManagement",
      "Effect": "Allow",
      "Action": [
        "servicediscovery:CreatePrivateDnsNamespace",
        "servicediscovery:DeleteNamespace",
        "servicediscovery:GetNamespace",
        "servicediscovery:ListNamespaces",
        "servicediscovery:CreateService",
        "servicediscovery:DeleteService",
        "servicediscovery:GetService",
        "servicediscovery:ListServices",
        "servicediscovery:GetOperation",
        "servicediscovery:TagResource",
        "servicediscovery:UntagResource"
      ],
      "Resource": ["*"]
    }
  ]
}
```

## License

MIT License
