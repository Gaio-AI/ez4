---
'@ez4/aws-aurora': patch
---

The native driver's IAM token no longer imports `formatUrl` from `@aws-sdk/core/util`: it writes the presigned URL with `buildQueryString` from `@smithy/core/protocols`, which the bundle carries. Function bundles leave `@aws-sdk/*` to the Lambda runtime, and the `nodejs24.x` runtime version `e46713f4` does not give the function's code `@aws-sdk/core`, so every function on the native driver failed to start there (`ERR_MODULE_NOT_FOUND`). The token is the same, byte for byte, as `@aws-sdk/rds-signer` builds; `@ez4/aws-aurora` no longer depends on `@aws-sdk/core`.
