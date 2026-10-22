# EZ4: Local Encryption

A local encryption emulator: under `ez4 serve --local` and `ez4 test --local`, the [Encryption](../../../contracts/encryption/) services and imports get a client that seals values with the local emulator key of [AWS KMS](../../aws/aws-kms/), so no AWS account is needed.

## Getting started

#### Install

```sh
npm install @ez4/local-encryption -D
```

## License

MIT License
