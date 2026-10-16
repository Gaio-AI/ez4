import type { AggregateMode } from '../types/mode';
import type { TableMetadata } from './table';

/**
 * Aggregate mode utils.
 */
export namespace AggregateModeUtils {
  /**
   * Aggregate input type based on the table metadata.
   */
  export type Input<T extends TableMetadata, I> = T['engine']['aggregateMode'] extends AggregateMode.Unsupported ? never : I;
}
