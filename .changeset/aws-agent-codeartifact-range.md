---
'@ez4/aws-agent': patch
---

The CodeArtifact client of `@ez4/aws-agent` accepts `^3.1152.0`, the AWS SDK line the other clients already take, so a project upgrading `@ez4` keeps its `@aws-sdk/core` and `@smithy/core`: `^3.1155.0` pulled both forward for every client (and into bundles that carry `@smithy/core`).
