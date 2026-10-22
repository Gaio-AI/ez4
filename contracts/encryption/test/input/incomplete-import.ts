import type { Encryption } from '@ez4/encryption';

declare class TestEncryption extends Encryption.Service {}

// @ts-expect-error Missing the imported project.
export declare class TestImport extends Encryption.Import<TestEncryption> {}
