---
'@ez4/aws-agent': minor
---

An agent granted `CodeArtifactRead` starts with registry auth in place: the task definition carries the grants as `EZ4_AGENT_CODEARTIFACT`, and the runtime asks CodeArtifact for a token with the task role and writes `~/.npmrc` (mode 600) before the workspace checkout and `prepare`. A failed token request ends the run as a failed invocation naming the repository, so `npm` and `pnpm` installs of private `@ez4` packages no longer fail with 401 inside an agent.
