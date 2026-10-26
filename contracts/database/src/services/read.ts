import type { EventualReadMode } from '../types/mode';
import type { TableMetadata } from './table';

/**
 * Eventual read mode utils.
 */
export namespace EventualReadModeUtils {
  /**
   * Read consistency input type based on the table metadata: only an engine that supports eventual reads takes it.
   */
  export type Input<T extends TableMetadata> = T['engine'] extends { eventualReadMode: EventualReadMode.Supported } ? boolean : never;
}
