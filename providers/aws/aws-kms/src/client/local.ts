import type { KeyProvider } from './envelope';

import { createHash, randomBytes } from 'node:crypto';

import { openValue, sealValue } from './envelope';

const DATA_KEY_BYTES = 32;
const IV_BYTES = 12;

/**
 * The key the local emulator seals data keys with. It is not a secret: values encrypted locally
 * live on a developer's machine, and anything that decrypts them there derives the same key.
 */
export const LOCAL_MASTER_KEY = createHash('sha256').update('ez4-local-encryption').digest();

/**
 * Data keys sealed with the local emulator key, so encryption works with no AWS account.
 */
export const createLocalKeyProvider = (): KeyProvider => ({
  source: 'local',

  generateDataKey: () => {
    const plaintext = randomBytes(DATA_KEY_BYTES);
    const { iv, ciphertext } = sealValue(LOCAL_MASTER_KEY, plaintext, Buffer.alloc(0));

    return Promise.resolve({
      plaintext,
      encrypted: Buffer.concat([iv, ciphertext])
    });
  },

  decryptDataKey: (encrypted) => {
    return new Promise((resolve) => {
      resolve(openValue(LOCAL_MASTER_KEY, encrypted.subarray(0, IV_BYTES), encrypted.subarray(IV_BYTES), Buffer.alloc(0)));
    });
  }
});
