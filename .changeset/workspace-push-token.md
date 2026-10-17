---
'@ez4/aws-agent': patch
---

The push of a workspace branch to the repository (`request.workspace.push` in the finish hook) uses a GitHub App token with `contents: write`. It used the read-only token that clones and fetches, so every push was refused with `Write access to repository not granted` (HTTP 403) and the run ended blocked with a finished fix. The write token is minted only for the push, in the runtime process after the model has finished, and is never in the model's environment; clone, fetch and the publication to the file-system cache keep asking for read. `WorkspaceRuntime.token` and `mintInstallationToken` take the access (`'read'` by default). A static workspace token is used as it is.
