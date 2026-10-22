import type { Encryption } from '@ez4/encryption';

declare class TestEncryption extends Encryption.Service {}

/**
 * @description Test encryption import.
 */
export declare class TestImport extends Encryption.Import<TestEncryption> {
  project: 'name from project in ez4.project.js';
}
