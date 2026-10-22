import type { Client as EncryptionClient, EncryptionContext } from '@ez4/encryption';

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

import { MalformedCiphertextError, UnexpectedKeySourceError } from './errors';

/**
 * The format of an encrypted value, which anything that decrypts it outside ez4 follows too:
 *
 * `ez4e1.<source>.<data key>.<iv>.<ciphertext>`, every part after `source` in base64url.
 *
 * - `source`: `kms`, where the data key is a KMS ciphertext blob, or `local`, where the local
 *   emulator sealed it.
 * - The value is AES-256-GCM under the data key, with a 12-byte iv, and `ciphertext` ends with the
 *   16-byte tag.
 * - The additional authenticated data is the context as JSON with its keys sorted, or nothing.
 */
export const ENVELOPE_VERSION = 'ez4e1';

const IV_BYTES = 12;
const TAG_BYTES = 16;

/** Data keys decrypted and kept per client, a bound on what a long-lived environment holds. */
const MAX_DATA_KEYS = 100;

export type DataKey = {
  plaintext: Uint8Array;
  encrypted: Uint8Array;
};

export type KeyProvider = {
  source: string;
  generateDataKey(): Promise<DataKey>;
  decryptDataKey(encrypted: Uint8Array): Promise<Uint8Array>;
};

const getAdditionalData = (context: EncryptionContext | undefined) => {
  const entries = Object.entries(context ?? {}).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

  return entries.length ? Buffer.from(JSON.stringify(Object.fromEntries(entries))) : Buffer.alloc(0);
};

export const sealValue = (key: Uint8Array, plaintext: Uint8Array, additionalData: Uint8Array) => {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv);

  cipher.setAAD(additionalData);

  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final(), cipher.getAuthTag()]);

  return { iv, ciphertext };
};

export const openValue = (key: Uint8Array, iv: Uint8Array, ciphertext: Uint8Array, additionalData: Uint8Array) => {
  if (ciphertext.length < TAG_BYTES) {
    throw new MalformedCiphertextError();
  }

  const decipher = createDecipheriv('aes-256-gcm', key, iv);

  decipher.setAAD(additionalData);
  decipher.setAuthTag(ciphertext.subarray(ciphertext.length - TAG_BYTES));

  return Buffer.concat([decipher.update(ciphertext.subarray(0, ciphertext.length - TAG_BYTES)), decipher.final()]);
};

const parseEnvelope = (value: string) => {
  const [version, source, dataKey, iv, ciphertext, ...rest] = value.split('.');

  if (version !== ENVELOPE_VERSION || !source || !dataKey || !iv || !ciphertext || rest.length) {
    throw new MalformedCiphertextError();
  }

  const ivBytes = Buffer.from(iv, 'base64url');

  if (ivBytes.length !== IV_BYTES) {
    throw new MalformedCiphertextError();
  }

  return {
    source,
    dataKey: Buffer.from(dataKey, 'base64url'),
    iv: ivBytes,
    ciphertext: Buffer.from(ciphertext, 'base64url')
  };
};

/**
 * An encryption client over a key provider. A client asks the provider for one data key and seals
 * every value with it, and opens each data key it is handed once: the provider is called once per
 * client lifetime for encrypting, and once per data key for decrypting. Keeping the key material in
 * memory between calls is what makes the provider affordable at every read.
 */
export const createEnvelopeClient = (provider: KeyProvider): EncryptionClient => {
  let currentKey: Promise<DataKey> | undefined;

  const openedKeys = new Map<string, Promise<Uint8Array>>();

  const getCurrentKey = () => {
    currentKey ??= provider.generateDataKey().catch((error) => {
      currentKey = undefined;
      throw error;
    });

    return currentKey;
  };

  const openDataKey = (encrypted: Uint8Array) => {
    const cacheKey = Buffer.from(encrypted).toString('base64url');
    const opened = openedKeys.get(cacheKey);

    if (opened) {
      return opened;
    }

    if (openedKeys.size >= MAX_DATA_KEYS) {
      const [oldest] = openedKeys.keys();
      openedKeys.delete(oldest!);
    }

    const decrypted = provider.decryptDataKey(encrypted).catch((error) => {
      openedKeys.delete(cacheKey);
      throw error;
    });

    openedKeys.set(cacheKey, decrypted);

    return decrypted;
  };

  return {
    encrypt: async (plaintext, context) => {
      const { plaintext: key, encrypted } = await getCurrentKey();
      const { iv, ciphertext } = sealValue(key, Buffer.from(plaintext, 'utf-8'), getAdditionalData(context));

      return [
        ENVELOPE_VERSION,
        provider.source,
        Buffer.from(encrypted).toString('base64url'),
        iv.toString('base64url'),
        ciphertext.toString('base64url')
      ].join('.');
    },

    decrypt: async (value, context) => {
      const envelope = parseEnvelope(value);

      if (envelope.source !== provider.source) {
        throw new UnexpectedKeySourceError(provider.source, envelope.source);
      }

      const key = await openDataKey(envelope.dataKey);

      return openValue(key, envelope.iv, envelope.ciphertext, getAdditionalData(context)).toString('utf-8');
    }
  };
};
