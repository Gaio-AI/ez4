import type { DecryptCommand, GenerateDataKeyCommand, KMSClient } from '@aws-sdk/client-kms';
import type { KeyProvider } from './envelope';

import { MissingDataKeyError } from './errors';

type KmsCache = {
  kmsClient: KMSClient;
  GenerateDataKeyCommand: typeof GenerateDataKeyCommand;
  DecryptCommand: typeof DecryptCommand;
};

let KMS_CACHE: Promise<KmsCache> | undefined;

const getKmsClient = async () => {
  if (!KMS_CACHE) {
    KMS_CACHE = import('@aws-sdk/client-kms')
      .then(({ KMSClient, GenerateDataKeyCommand, DecryptCommand }) => {
        return {
          kmsClient: new KMSClient(),
          GenerateDataKeyCommand,
          DecryptCommand
        };
      })
      .catch((error) => {
        KMS_CACHE = undefined;
        throw error;
      });
  }

  return KMS_CACHE;
};

/**
 * Data keys from a KMS key, named by its alias. The key itself never leaves KMS.
 */
export const createKmsKeyProvider = (keyId: string): KeyProvider => ({
  source: 'kms',

  generateDataKey: async () => {
    const { kmsClient, GenerateDataKeyCommand } = await getKmsClient();

    const { Plaintext, CiphertextBlob } = await kmsClient.send(
      new GenerateDataKeyCommand({
        KeyId: keyId,
        KeySpec: 'AES_256'
      })
    );

    if (!Plaintext || !CiphertextBlob) {
      throw new MissingDataKeyError();
    }

    return {
      plaintext: Plaintext,
      encrypted: CiphertextBlob
    };
  },

  decryptDataKey: async (encrypted) => {
    const { kmsClient, DecryptCommand } = await getKmsClient();

    const { Plaintext } = await kmsClient.send(
      new DecryptCommand({
        CiphertextBlob: encrypted,
        KeyId: keyId
      })
    );

    if (!Plaintext) {
      throw new MissingDataKeyError();
    }

    return Plaintext;
  }
});
