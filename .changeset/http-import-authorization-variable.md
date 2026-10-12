---
'@ez4/aws-gateway': patch
---

The key of an `Http.Import` with `authorization` reaches the linked functions as the environment variable `EZ4_HTTP_AUTHORIZATION_<SERVICE>` instead of a literal in their bundle. Build outputs and copies of the code no longer carry it, a new key updates the function configuration without a rebuild, and the plan and the state keep only a hash of it. Like every linked variable, it goes to all functions of the service that links the import, so the first deploy on this version updates each of them, and rebuilds the ones whose code builds that client.
