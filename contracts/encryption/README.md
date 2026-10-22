# EZ4: Encryption

The Encryption contract defines a key your handlers encrypt and decrypt values with, without ever holding the key itself: a secret a customer saves (an API key, a token) is stored encrypted and opened only where it is used. It uses EZ4's [reflection](../../foundation/reflection/) system to read the service declaration, then generates the key, the permissions of every handler linked to it and the runtime client.

## Getting started

#### Install

```sh
npm install @ez4/encryption @ez4/aws-kms @ez4/local-encryption -D
```

#### Create an encryption service

```ts
import type { Encryption } from '@ez4/encryption';

// Secrets declaration
export declare class Secrets extends Encryption.Service {}
```

#### Use it

Any handler with access to the service encrypts and decrypts values. A value may be bound to a context, which decrypting has to repeat, so a value copied to another account does not open there.

```ts
import type { Service } from '@ez4/common';
import type { Secrets } from './secrets';

export async function saveKeyHandler(request: SaveKeyRequest, context: Service.Context<Provider>) {
  const { secrets } = context;
  const { accountId, apiKey } = request.body;

  const stored = await secrets.encrypt(apiKey, { accountId });

  // Persist `stored`; later: await secrets.decrypt(stored, { accountId })
}
```

#### Use another project's key

A project decrypts what another one encrypted by importing its service. The imported project is named in `ez4.project.js` and deploys the key; this one only gets permission to use it.

```ts
import type { Encryption } from '@ez4/encryption';
import type { Secrets } from '@my-org/console';

export declare class ConsoleSecrets extends Encryption.Import<Secrets> {
  project: 'console';
}
```

## Providers

- [AWS KMS](../../providers/aws/aws-kms/).
- [Local Encryption](../../providers/local/local-encryption/), the local emulator.

## License

MIT License
