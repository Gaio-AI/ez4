---
'@ez4/aws-aurora': patch
---

The native driver's `@smithy/core` range starts at `3.35.0`, the first version with the `checksum` and `protocols` exports it uses, so consumers on `3.35.0` take the release without moving that package.
