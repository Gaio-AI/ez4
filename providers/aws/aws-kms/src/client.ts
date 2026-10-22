import type { Client as EncryptionClient } from '@ez4/encryption';

import { createEnvelopeClient } from './client/envelope';
import { createKmsKeyProvider } from './client/kms';
import { createLocalKeyProvider } from './client/local';

export { ENVELOPE_VERSION } from './client/envelope';
export * from './client/errors';

export namespace Client {
  export type Options = {
    /**
     * The KMS key, by its alias (`alias/<name>`).
     */
    keyId: string;
  };

  /**
   * Encrypt and decrypt with a KMS key.
   */
  export const make = (options: Options): EncryptionClient => {
    return createEnvelopeClient(createKmsKeyProvider(options.keyId));
  };

  /**
   * Encrypt and decrypt with the local emulator key, with no AWS account.
   */
  export const makeLocal = (): EncryptionClient => {
    return createEnvelopeClient(createLocalKeyProvider());
  };
}
