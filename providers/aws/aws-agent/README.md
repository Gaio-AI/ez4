# EZ4: AWS Agent

It provides all the components to run autonomous agents and orchestrate multi-agent workflows on AWS ECS Fargate with network isolation, shared git workspaces, and least-privilege IAM policies.

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
  - Workflow state: `workflows/<Workflow>/<runId>.json` storing step transitions and execution history.

- **IAM Roles & Security**:
  - Per-agent task role grants artifact reads only for its own prefix and linked agents' prefixes, plus `AgentPermission` grants scoped to the resource names they declare (`{prefix}`/`{project}` resolved per deploy) and custom statements.
  - Execution role used by ECS to pull images and inject secrets from AWS Secrets Manager.

- **Shared Git Workspaces**:
  - Backed by an Amazon EFS file system (`${base}-workspace`) provisioned via `@ez4/aws-efs` with POSIX access points.
  - Caches bare git repositories on shared storage to avoid redundant full clones across invocations.
  - Per-agent container working trees are mounted at `/mnt/ez4-workspace`.
  - Handoff between agents tracks commit changes and branch state using custom invocation refs (`refs/ez4/<agent>/<invocationId>`).
  - Supports repository authentication through GitHub Apps (`{ githubApp: 'secret-name' }`) or HTTPS personal access tokens (`{ token: 'secret-name' }` or `'secret-name:jsonKey'`).

- **Agent Workflows**:
  - Declarative state machine orchestration across multiple `Agent.Service` instances.
  - Provisioned with an SQS start queue (`${base}-${kebab(workflow)}-start`), an SQS FIFO results queue (`${base}-${kebab(workflow)}-results.fifo`), and a dedicated step runner Lambda (`${base}-${kebab(workflow)}`).
  - Manages atomic state persistence in S3 with conditional writes, automatic step incrementing, and step limits (`maxSteps`, default 10, range 1..100).
  - Client interface supports `workflow.start(input, { runId? })` to begin runs and `workflow.status(runId)` to poll progress.

- **Egress Proxy Sandbox**:
  - Outbound traffic is restricted through an internal Squid proxy (`public.ecr.aws/ubuntu/squid`) deployed as an ECS service in the agents cluster.
  - Registered under Cloud Map private DNS namespace `<base>.local` with endpoint `http://proxy.<base>.local:3128` (where `<base>` = `${prefix}-${projectName}[-${branch}]-agents`).
  - Per-agent basic authentication password is saved in AWS Secrets Manager (`<base>-<agent>-proxy`); the proxy receives only the htpasswd hash.
  - Allowlist enforces domains declared in `egress`, provider domains (`api.anthropic.com`), AWS endpoints of granted permissions and statement actions, and runtime ECS and STS endpoints.
  - `NO_PROXY` bypasses the proxy for AWS S3, ECS/EC2 metadata endpoints, and configured VPC interface endpoints. DynamoDB requests use the proxy.

- **Modular Provider Architecture**:
  - The agent provider delegates generic AWS resource management to dedicated library packages:
    - `@ez4/aws-ecr`: ECR repositories and container image builds.
    - `@ez4/aws-ecs`: ECS clusters, task definitions, services, and task execution clients.
    - `@ez4/aws-efs`: EFS file systems, mount targets, and access points for workspaces.
    - `@ez4/aws-cloudmap`: Private DNS service discovery namespaces for proxy routing.
    - `@ez4/aws-events`: EventBridge rules for task lifecycle dispatching and sweep schedules.
    - `@ez4/aws-secret`: Secrets Manager integration for credentials and tokens.
    - `@ez4/aws-vpc`: VPC subnet and security group discovery by tags.

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
  - A failed FIFO send leaves the result undispatched so Lambda retries it; the scheduled sweep also delivers stored results missing a dispatch marker, including RunTask startup failures. Without a reply queue, RunTask startup failures throw to the caller.

#### Network discovery

Agent tasks, workspaces, and the egress proxy discover existing VPC infrastructure by resource tags:

- **Agents**: subnets and security group tagged `ez4:agents=true`.
- **Workspaces**: security group tagged `ez4:agents-efs=true`.
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
      "Action": [
        "ecs:*",
        "ecr:*",
        "iam:PassRole",
        "servicediscovery:*",
        "events:*",
        "secretsmanager:*",
        "s3:*",
        "elasticfilesystem:*",
        "sqs:*"
      ],
      "Resource": ["*"]
    }
  ]
}
```

#### Provider login

Agents using an external model provider (such as `claude`) require authentication credentials to interact with the provider API.

- **Stage secret reuse**: Credentials are stored in AWS Secrets Manager under `${prefix}/agents/${provider}` (e.g. `ez4/agents/claude`) as a JSON secret containing the provider's token environment variable (e.g. `CLAUDE_CODE_OAUTH_TOKEN`). This secret is shared across all projects and agents in the stage.
- **Interactive prompt on first deploy**: When deploying in an interactive terminal and the secret does not exist, the CLI runs the provider's login command (e.g. `claude setup-token`) to open a browser OAuth session, prompts for the resulting token (masked), and stores it in Secrets Manager.
- **CI / Non-interactive environments**: In automated or non-interactive environments (e.g. CI runs with `CI=true`), if the secret is missing, deployment fails fast with a `ProviderLoginRequiredError` naming the secret and environment variable. Create the secret manually or run an initial interactive deploy.
- **Per-agent override**: An agent can override the stage-shared credential by declaring its own token in `secrets` (e.g. `secrets: { CLAUDE_CODE_OAUTH_TOKEN: 'my-custom-secret' }`). In this case, the provider login flow is bypassed for that agent.
- **Forced re-authentication**: Setting the environment variable `EZ4_AGENT_LOGIN=force` forces re-running the interactive login and updating the stored Secrets Manager secret even if it already exists.

## License

MIT License
