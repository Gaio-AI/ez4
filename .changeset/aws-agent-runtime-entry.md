---
'@ez4/aws-agent': patch
---

What the deploy bundles from `@ez4/aws-agent` no longer carries the deploy code and, through `@ez4/project` and `@ez4/reflection`, the whole TypeScript compiler. The agent image, the dispatcher and workflow functions, and every function linked to an agent or a workflow change bytes once, and from then on a change to the deploy code of ez4 no longer reaches them.

- The runtime templates import from entries of their own: the agent image from `@ez4/aws-agent/runtime`, the dispatcher and workflow functions from `@ez4/aws-agent/handlers`, which leaves out the provider SDK only the image runs. They imported `@ez4/aws-agent/library` before.
- The client (`@ez4/aws-agent/client`) took the container name from the task definition module, which imports `@ez4/aws-ecs` and `@ez4/aws-efs` and through them `@ez4/project`. The name now comes from the module of resource names, and `@ez4/aws-agent/library` still exports `AGENT_CONTAINER_NAME`.

Bundled the way the deploy does it, without the project's own code (raw / gzip): the agent's bundle in the image goes from 11.4 MB / 2.3 MB to 1.1 MB / 252 KB, the dispatcher from 8.8 MB / 1.9 MB to 10 KB / 4 KB, and a workflow function or a function linked to an agent or a workflow from 8.8 MB / 1.9 MB to 44 KB / 14 KB.
