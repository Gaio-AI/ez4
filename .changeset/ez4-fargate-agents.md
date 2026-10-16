---
'@ez4/agent': minor
'@ez4/aws-agent': minor
'@ez4/aws-cloudmap': minor
'@ez4/aws-ecr': minor
'@ez4/aws-ecs': minor
'@ez4/aws-efs': minor
'@ez4/aws-events': minor
'@ez4/aws-secret': minor
'@ez4/local-agent': minor
---

Introduce autonomous Agent contract with AWS ECS Fargate execution provider:

- Declarative `Agent.Service` contract with schema reflection, typed hooks, resource bounds, and egress allowlists.
- Contract values exported as enums: `AgentProvider`, `ClaudeModel`, `ClaudeTool`, `AgentToolsMode`, `AgentResultStatus`, `AgentErrorCode`, `WorkflowEventType` and `WorkflowRunStatus`. Hooks take `(request, context)` like other ez4 handlers.
- Declarative `Agent.Workflow` state machines orchestrating multi-step execution flows across agents with typed step transitions, step limits, and start/result event processing; a workflow declares its `state` type next to `input`, so handlers read a typed state.
- Shared `Agent.Workspace` git repositories cached on Amazon EFS with branch/commit handoff via custom refs (`refs/ez4/<agent>/<invocationId>`) and GitHub App or token authentication. GitHub App credentials (`appId`, `installationId`, `privateKey`, usually environment variables) are stored in a Secrets Manager secret ez4 manages per agent and rewrites when they change; `@ez4/aws-secret` secrets accept a `valueHash` for such declared values.
- The finish hook pushes a published commit to a branch of the repository remote with `request.workspace.push(repo, branch)`, using the workspace credentials the model never sees; only fast-forwards land and the workspace branch is refused.
- Isolated AWS Fargate task execution with per-agent task IAM roles, granting `AgentPermission` read access only to the resources an agent names within its deploy prefix, and `CodeArtifactRead` package installs from named `<domain>/<repository>` account repositories.
- Egress network proxy using Squid and Cloud Map private DNS (`<base>.local`) enforcing per-agent domain allowlists: provider, workspace and permission hosts are allowed automatically, `egress` adds the rest.
- Claude provider integration via `@anthropic-ai/claude-agent-sdk` supporting both edit and readonly permission modes.
- Idempotent EventBridge dispatcher routing completed agent results to FIFO caller queues.
- Modular AWS library providers split into dedicated packages for reusable infrastructure management: `@ez4/aws-ecr`, `@ez4/aws-ecs`, `@ez4/aws-efs`, `@ez4/aws-cloudmap`, `@ez4/aws-events`, and `@ez4/aws-secret`.
- `WorkflowClient.fromStage` builds a workflow client from the stage's `prefix`, `projectName` and `branchName` by resolving the start queue and state bucket by name, so scripts outside the deploy can start and read runs; `inputSchema` is optional.
- Agent resources are named `<prefix>-<project>[-<branch>]-agents`; the `agents` suffix is left out when the project is already called `agents`.
