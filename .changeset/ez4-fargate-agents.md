---
'@ez4/agent': minor
'@ez4/aws-agent': minor
'@ez4/local-agent': minor
---

Introduce autonomous Agent contract with AWS ECS Fargate execution provider:

- Declarative `Agent.Service` contract with schema reflection, typed hooks, resource bounds, and egress allowlists.
- Isolated AWS Fargate task execution with per-agent task IAM roles and least-privilege presets.
- Egress network proxy using Squid and Cloud Map private DNS (`<base>.local`) enforcing per-agent domain allowlists.
- Claude provider integration via `@anthropic-ai/claude-agent-sdk` supporting both edit and readonly permission modes.
- Idempotent EventBridge dispatcher routing completed agent results to FIFO caller queues.
