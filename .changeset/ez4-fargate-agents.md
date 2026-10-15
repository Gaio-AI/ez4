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
- Declarative `Agent.Workflow` state machines orchestrating multi-step execution flows across agents with typed step transitions, step limits, and start/result event processing.
- Shared `Agent.Workspace` git repositories cached on Amazon EFS with branch/commit handoff via custom refs (`refs/ez4/<agent>/<invocationId>`) and GitHub App or token authentication.
- Isolated AWS Fargate task execution with per-agent task IAM roles, granting `AgentPermission` read access only to the resources an agent names within its deploy prefix.
- Egress network proxy using Squid and Cloud Map private DNS (`<base>.local`) enforcing per-agent domain allowlists.
- Claude provider integration via `@anthropic-ai/claude-agent-sdk` supporting both edit and readonly permission modes.
- Idempotent EventBridge dispatcher routing completed agent results to FIFO caller queues.
- Modular AWS library providers split into dedicated packages for reusable infrastructure management: `@ez4/aws-ecr`, `@ez4/aws-ecs`, `@ez4/aws-efs`, `@ez4/aws-cloudmap`, `@ez4/aws-events`, and `@ez4/aws-secret`.
