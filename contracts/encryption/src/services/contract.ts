import type { Service as CommonService } from '@ez4/common';
import type { Client } from './client';

/**
 * Provide all contracts for a self-managed encryption service.
 */
export namespace Encryption {
  /**
   * Encryption service: a key that never leaves the provider, which the handlers linked to it
   * encrypt and decrypt values with.
   */
  export declare abstract class Service implements CommonService.Provider {
    /**
     * Service client.
     */
    readonly client: Client;

    /**
     * No service options available.
     */
    readonly options: never;
  }

  /**
   * Imported encryption service: decrypt (and encrypt) values with another project's key.
   */
  export declare abstract class Import<T extends Service> implements CommonService.Provider {
    /**
     * Name of the imported project defined in the project options file.
     */
    abstract readonly project: string;

    /**
     * Imported encryption service reference.
     */
    readonly reference: T;

    /**
     * Service client.
     */
    readonly client: Client;

    /**
     * No service options available.
     */
    readonly options: never;
  }
}
