---
'@ez4/aws-kms': patch
---

A project that links an `Encryption.Import` to a factory, or to any service whose connections are gathered through its links, deploys again. The import is now kept as a virtual service, so it resolves to no connection of its own. Before this, it was never registered, and the deploy stopped at `Service '<prefix>-<project>-<import>' wasn't found` before planning anything. The import still adds nothing to the project's state, and the runtime client (`@ez4/aws-kms/client`) is unchanged.
