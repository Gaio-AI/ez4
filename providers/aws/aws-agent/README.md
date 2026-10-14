# EZ4: AWS Agent

It provides all the components to run autonomous agents on AWS ECS Fargate with network isolation and least-privilege IAM policies.

## Getting started

#### Install

```sh
npm install @ez4/aws-agent -D
```

#### Architecture

Each declared agent is packaged into a container image and run as an isolated AWS ECS Fargate task within an agents cluster.

- **Execution & Storage Layout**:
  - Invocations: `invocations/<agent>/<id>.json` containing invocation payload, deadline, cluster, and task ARN.
  - Results: `results/<agent>/<id>.json` containing execution status, output, or error details.
  - Artifacts: `artifacts/<agent>/<id>/<key>`.
  - Dispatched markers: `dispatched/<agent>/<id>`.

- **IAM Roles & Security**:
  - Per-agent task role granting access to S3 prefixes and least-privilege permission presets (`logs-read`, `lambda-read`, `ecs-read`, `cloudformation-read`) or custom statements.
  - Execution role used by ECS to pull images and inject secrets from AWS Secrets Manager.

- **Egress Proxy Sandbox**:
  - Outbound traffic is restricted through an internal Squid proxy (`public.ecr.aws/ubuntu/squid`) deployed as an ECS service in the agents cluster.
  - Registered under Cloud Map private DNS namespace `<base>.local` with endpoint `http://proxy.<base>.local:3128` (where `<base>` = `${prefix}-${projectName}[-${branch}]-agents`).
  - Per-agent basic authentication password is saved in AWS Secrets Manager (`<base>-<agent>-proxy`); the proxy receives only the htpasswd hash.
  - Allowlist enforces domains declared in `egress`, provider domains (`api.anthropic.com`), and AWS endpoints derived from permission presets.
  - `NO_PROXY` bypasses proxy for AWS S3, ECS/EC2 metadata endpoints, and VPC interface endpoints.

- **Container Environment Variables**:
  - `EZ4_AGENT_NAME`: Name of the agent service.
  - `EZ4_AGENT_ID`: Unique invocation ID.
  - `EZ4_AGENT_BUCKET`: S3 storage bucket name.
  - `EZ4_AGENT_TIMEOUT`: Execution timeout in seconds.
  - `EZ4_AGENT_PROXY_URL`: Authenticated proxy URL (`http://<agent>:<password>@proxy.<base>.local:3128`).
  - `NO_PROXY`: Comma-separated list of bypass domains and IP ranges.

- **EventBridge Dispatcher**:
  - `<base>-dispatcher` Lambda receives task lifecycle events.
  - `<base>-task-stopped`: EventBridge rule triggered on ECS task STOPPED events.
  - `<base>-sweep`: EventBridge scheduled rule running every 15 minutes to recover untracked or timed-out executions.
  - Dispatches completed execution results to caller FIFO queues (`MessageGroupId = agentName`, `MessageDeduplicationId = id`).

#### Network discovery

Agent tasks and the egress proxy discover existing VPC infrastructure by resource tags:

- **Agents**: subnets and security group tagged `ez4:agents=true`.
- **Proxy**: security group tagged `ez4:agents-proxy=true`.

#### Permission

Ensure the user performing deployments has the permissions below:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AgentManagement",
      "Effect": "Allow",
      "Action": ["ecs:*", "ecr:*", "iam:PassRole", "servicediscovery:*", "events:*", "secretsmanager:*", "s3:*"],
      "Resource": ["*"]
    }
  ]
}
```

## License

MIT License
