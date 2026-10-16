import type { AnyObject, IsUndefined, Prettify } from '@ez4/utils';
import type { Order } from '../../types/order';
import type { TableMetadata } from '../table';
import type { WhereFieldInput } from './where';

type AggregateFunctions = 'count' | 'sum' | 'min' | 'max';

type AggregateNumberColumn<S extends AnyObject> = {
  [P in keyof S]-?: NonNullable<S[P]> extends number ? P : never;
}[keyof S] &
  string;

type AggregateComparableColumn<S extends AnyObject> = {
  [P in keyof S]-?: NonNullable<S[P]> extends number | string ? P : never;
}[keyof S] &
  string;

type AggregateOnly<F extends AggregateFunctions> = {
  [P in Exclude<AggregateFunctions, F>]?: never;
};

type AggregateFilter<T extends TableMetadata> = {
  /**
   * Aggregate only the records matching the filter.
   */
  where?: WhereFieldInput<T>;
};

/**
 * Table columns to aggregate or group by.
 */
export type AggregateColumn<T extends TableMetadata> = keyof T['schema'] & string;

/**
 * Count the records (`true`) or the non-null values of a column, optionally only the distinct ones.
 */
export type AggregateCountField<T extends TableMetadata> = AggregateFilter<T> &
  AggregateOnly<'count'> &
  (
    | {
        count: true;
        distinct?: never;
      }
    | {
        count: AggregateColumn<T>;
        distinct?: boolean;
      }
  );

/**
 * Sum the values of a number column.
 */
export type AggregateSumField<T extends TableMetadata> = AggregateFilter<T> &
  AggregateOnly<'sum'> & {
    sum: AggregateNumberColumn<T['schema']>;
  };

/**
 * Lowest value of a number or string column.
 */
export type AggregateMinField<T extends TableMetadata> = AggregateFilter<T> &
  AggregateOnly<'min'> & {
    min: AggregateComparableColumn<T['schema']>;
  };

/**
 * Highest value of a number or string column.
 */
export type AggregateMaxField<T extends TableMetadata> = AggregateFilter<T> &
  AggregateOnly<'max'> & {
    max: AggregateComparableColumn<T['schema']>;
  };

export type AggregateField<T extends TableMetadata> =
  | AggregateCountField<T>
  | AggregateSumField<T>
  | AggregateMinField<T>
  | AggregateMaxField<T>;

export type AggregateSelectInput<T extends TableMetadata> = Record<string, AggregateField<T>>;

export type AggregateQueryInput<B extends AggregateColumn<T>, A extends AggregateSelectInput<T>, T extends TableMetadata> = {
  /**
   * Columns to group the records by, one result per group. Without them, the result is exactly one.
   * A group column can't take the name of an aggregate alias.
   */
  by?: (B & NoInfer<Exclude<B, keyof A>>)[];

  /**
   * Aggregates by result alias.
   */
  select: A;

  /**
   * Records to aggregate.
   */
  where?: WhereFieldInput<T>;

  /**
   * Result order by group column or aggregate alias.
   */
  order?: { [P in NoInfer<B> | keyof NoInfer<A>]?: Order };

  skip?: number;
  take?: number;
};

type AggregateValue<V> = IsUndefined<V> extends true ? Exclude<V, undefined> | null : V;

type AggregateColumnValue<C, S extends AnyObject> = C extends keyof S ? NonNullable<S[C]> | null : never;

type AggregateFieldValue<F, S extends AnyObject> = F extends { count: any }
  ? number
  : F extends { sum: any }
    ? number | null
    : F extends { min: infer C }
      ? AggregateColumnValue<C, S>
      : F extends { max: infer C }
        ? AggregateColumnValue<C, S>
        : never;

export type AggregateRecord<B extends PropertyKey, A extends AnyObject, T extends TableMetadata> = Prettify<
  {
    [P in B & keyof T['schema']]: AggregateValue<T['schema'][P]>;
  } & {
    [P in keyof A]: AggregateFieldValue<A[P], T['schema']>;
  }
>;
