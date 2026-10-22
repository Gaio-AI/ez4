# EZ4: AWS KMS

Provider of the [Encryption](../../../contracts/encryption/) contract on AWS KMS.

## What it deploys

- One symmetric KMS key per `Encryption.Service`, with automatic yearly rotation, named by the alias `alias/<prefix>-<project>-<service>`.
- A policy for every function of the project that can draw a data key and open one (`kms:GenerateDataKey`, `kms:Decrypt`) from the keys whose alias starts with the project's prefix, or the prefix of a project it imports. The permissions boundary of the functions has to allow both actions.
- Deleting the service keeps the key unless the deploy runs with `--force`, and even then KMS keeps it for 30 days, when cancelling the deletion restores everything it encrypted.

## How values are encrypted

Envelope encryption: a client draws one data key from KMS and seals every value with it locally, and opens each data key it is handed once, keeping it in memory. KMS is called once per client lifetime to encrypt and once per data key to decrypt, not at every value.

An encrypted value is a string anything can decrypt outside EZ4:

```
ez4e1.<source>.<data key>.<iv>.<ciphertext>
```

- Every part after `source` is base64url.
- `source` is `kms`, where the data key is a KMS ciphertext blob (decrypt it with `Decrypt`), or `local`, where the local emulator sealed it.
- The value is AES-256-GCM under the 32-byte data key, with a 12-byte iv; `ciphertext` ends with the 16-byte tag.
- The additional authenticated data is the encryption context as JSON with its keys sorted, or nothing when there is none.

A client only opens values of its own source: the KMS client refuses a `local` value.

## Local mode

Under `ez4 serve --local` and `ez4 test --local`, with [Local Encryption](../../local/local-encryption/) installed, the client seals data keys with a fixed local key instead of KMS (AES-256-GCM under `sha256("ez4-local-encryption")`, the data key's iv first), so no AWS account is needed. The local key is not a secret, and values encrypted locally are only for local use.

## License

MIT License
