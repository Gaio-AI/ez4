import type { Array, Object, String } from '@ez4/schema';
import type { AnyObject } from '@ez4/utils';

enum Provider {
  Instagram = 'instagram',
  WhatsApp = 'whatsapp'
}

type SearchFilter = {
  field: 'search';
  operator: 'contains';
  value: [string];
};

type ScoreFilter = {
  field: 'score';
  operator: 'between';
  value: [number, number];
};

type TagFilter = {
  field: 'tag';
  operator: 'in' | 'not_in';
  value: String.UUID[];
};

type ProviderFilter = {
  field: 'provider';
  operator: 'in';
  value: Provider[];
};

type DateSingleFilter = {
  field: 'date';
  operator: 'before' | 'after';
  value: [String.DateTime];
};

type DateRangeFilter = {
  field: 'date';
  operator: 'between';
  value: [String.DateTime, String.DateTime];
};

type DateFilter = DateSingleFilter | DateRangeFilter;

type ContactFilter = TagFilter | ProviderFilter | DateFilter;

type HandwrittenFilter = SearchFilter | ScoreFilter | ContactFilter;

type FilterOperator = 'contains' | 'between' | 'in' | 'not_in' | 'before' | 'after';

type DynamicFilterField<TField extends string, TOperator extends FilterOperator, TValue extends unknown[]> = {
  field: TField;
  operator: TOperator;
  value: TValue;
};

type GenericFilter =
  | DynamicFilterField<'search', 'contains', [string]>
  | DynamicFilterField<'score', 'between', [number, number]>
  | DynamicFilterField<'tag', 'in' | 'not_in', String.UUID[]>
  | DynamicFilterField<'provider', 'in', Provider[]>
  | (
      | DynamicFilterField<'date', 'before' | 'after', [String.DateTime]>
      | DynamicFilterField<'date', 'between', [String.DateTime, String.DateTime]>
    );

type IndexedFilters<TFilters extends unknown[]> = {
  filters?: Array.Base64<TFilters[number]>;
};

type ConditionalFilters<TFilters extends AnyObject> = {
  filters?: TFilters extends readonly unknown[] ? Array.Base64<TFilters[number]> : Object.Base64<TFilters>;
};

/**
 * @description Union of filter objects inside base64-encoded arrays.
 */
export interface UnionFiltersTestSchema {
  handwritten: Array.Base64<HandwrittenFilter>;

  generic: Array.Base64<GenericFilter>;

  indexed: IndexedFilters<HandwrittenFilter[]>;

  conditional: ConditionalFilters<HandwrittenFilter[]>;

  conditionalObject: ConditionalFilters<{ search: string }>;
}
