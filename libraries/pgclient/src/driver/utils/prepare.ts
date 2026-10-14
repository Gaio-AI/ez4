import type { FieldParameter } from './fields';

export type PrepareStatementOptions = {
  /**
   * Bind every occurrence of a named parameter on its own, as the Data API does.
   */
  bindEachOccurrence?: boolean;

  /**
   * Bind a list of scalars as one Postgres array where the statement casts its parameter to an array type
   * (`:ids::uuid[]`). Without it the list keeps its JSON binding, as the Data API has no array parameters.
   */
  bindArrays?: boolean;
};

export const prepareStatement = (
  query: string,
  variables?: FieldParameter[],
  options?: PrepareStatementOptions
): [string, unknown[] | undefined] => {
  if (!variables?.length) {
    return [query, undefined];
  }

  const preparedValues: unknown[] = [];
  const fieldIndexes: Record<string, number> = {};

  const fieldParameters = variables.reduce<Record<string, FieldParameter>>((map, variable) => {
    map[variable.name] = variable;
    return map;
  }, {});

  let totalFields = 0;

  const bindField = (key: string, value: unknown) => {
    if (!fieldIndexes[key] || options?.bindEachOccurrence) {
      fieldIndexes[key] = ++totalFields;
      preparedValues.push(value);
    }

    return fieldIndexes[key];
  };

  const preparedQuery = query.replaceAll(/:(\w+)(::\w+\[\])?/g, (occurrence, fieldName: string, arrayCast?: string) => {
    const parameter = fieldParameters[fieldName];

    if (!parameter) {
      return occurrence;
    }

    const { type, value, elements } = parameter;

    // The statement's own cast types the array, and the parameter's JSON binding keeps a separate index.
    if (arrayCast && elements && options?.bindArrays) {
      return `$${bindField(`${fieldName}[]`, elements)}${arrayCast}`;
    }

    const index = bindField(fieldName, value);

    const placeholder = type ? `$${index}::${type}` : `$${index}`;

    return arrayCast ? `${placeholder}${arrayCast}` : placeholder;
  });

  return [preparedQuery, preparedValues];
};
