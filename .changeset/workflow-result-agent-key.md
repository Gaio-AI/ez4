---
'@ez4/aws-agent': patch
---

The `agent` of a workflow result event is the key the workflow invoked the agent with (`implement`), as `Agent.Workflow` types it, and no longer the agent class name (`ImplementAgent`) the result carries. A handler that tells its agents apart by that key never matched, so every result fell into its fallback branch.
