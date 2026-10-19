---
'@ez4/agent': minor
'@ez4/aws-agent': minor
---

A `prepare` hook can return `instructions`, which the runtime appends to the agent's declared `instructions` for that run. The declared `instructions` is a literal read at build time, so this is how an agent receives text it has to compute, such as a registry of skills shared by every agent.
