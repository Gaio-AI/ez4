---
'@ez4/aws-agent': minor
---

An agent granted `CodeArtifactRead` starts with registry auth in place: the task definition carries the grants as `EZ4_AGENT_CODEARTIFACT`, and the runtime asks CodeArtifact for a token with the task role and writes `~/.npmrc` (mode 600) before the workspace checkout and `prepare`. A failed token request ends the run as a failed invocation naming the repository, so `npm` and `pnpm` installs of private `@ez4` packages no longer fail with 401 inside an agent.

The agent image also puts `/app/node_modules/.bin` on `PATH`, so the binaries of the declared `npmPackages` (such as `pnpm`) run from the agent and its hooks.

When the workspace uses a GitHub App, every commit of the run is authored and committed as that App (`<slug>[bot]` with its noreply address), whether made by the agent or by the runtime when it publishes leftover changes. The identity comes from the GitHub API with the App JWT; if the lookup fails the run fails instead of committing under another identity.
