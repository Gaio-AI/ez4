/**
 * What a value is bound to, besides the key. Decrypting takes the same context the value was
 * encrypted with, so a value copied to another account (say) does not decrypt there.
 */
export type EncryptionContext = Record<string, string>;

/**
 * Encryption client.
 */
export interface Client {
  /**
   * Encrypt the given value.
   *
   * @param plaintext Value to encrypt.
   * @param context Optional context the value is bound to.
   * @returns Returns the encrypted value, an opaque string.
   */
  encrypt(plaintext: string, context?: EncryptionContext): Promise<string>;

  /**
   * Decrypt a value the service encrypted.
   *
   * @param ciphertext Encrypted value.
   * @param context The context the value was encrypted with.
   * @returns Returns the original value.
   */
  decrypt(ciphertext: string, context?: EncryptionContext): Promise<string>;
}
