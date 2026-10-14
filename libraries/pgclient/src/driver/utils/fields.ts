import type { AnySchema } from '@ez4/schema';

import { isDate, isDateTime, isTime, isUUID } from '@ez4/utils';
import { UnsupportedFieldTypeError } from '@ez4/pgclient';
import { SchemaType } from '@ez4/schema';

import { isJsonLikeField } from '../../utils/schema';

export type FieldParameter = {
  name: string;
  type?: string;
  value: unknown;

  /**
   * Values of a list of scalars, bound as one Postgres array where the statement casts the variable to an array type.
   */
  elements?: unknown[];
};

export const prepareArrayFieldData = (name: string, values: unknown[], schema?: AnySchema): FieldParameter | undefined => {
  if (schema && isJsonLikeField(schema)) {
    return undefined;
  }

  const fields = values.map((value) => (schema ? prepareFieldData(name, value, schema) : detectFieldData(name, value)));

  // A null value has no type of its own and goes inside an array of any type.
  const types = new Set(fields.flatMap(({ type }) => (type ? [type] : [])));

  // Values of mixed types, only nulls or JSON have no single array type.
  if (types.size !== 1 || types.has('jsonb')) {
    return undefined;
  }

  const [type] = types;

  return {
    name,
    type: `${type}[]`,
    value: fields.map(({ value }) => value)
  };
};

export const prepareFieldData = (name: string, value: unknown, schema: AnySchema): FieldParameter => {
  if (isJsonLikeField(schema)) {
    return getJsonFieldData(name, value as object);
  }

  if (value === null) {
    return getNullFieldData(name);
  }

  switch (schema.type) {
    case SchemaType.Boolean:
      return getBooleanFieldData(name, value as boolean);

    case SchemaType.Number:
      return getNumberFieldData(name, value as number, schema.format);

    case SchemaType.String:
      return getStringFieldData(name, value as string, schema.format);

    default:
      return getTextFieldData(name, value as string);
  }
};

export const detectFieldData = (name: string, value: unknown): FieldParameter => {
  switch (typeof value) {
    case 'boolean': {
      return getBooleanFieldData(name, value);
    }

    case 'number': {
      if (Number.isSafeInteger(value)) {
        return getIntegerFieldData(name, value);
      }

      return getDecimalFieldData(name, value);
    }

    case 'string': {
      if (isDateTime(value)) {
        return getDateTimeFieldData(name, value);
      }

      if (isDate(value)) {
        return getDateFieldData(name, value);
      }

      if (isTime(value)) {
        return getTimeFieldData(name, value);
      }

      if (isUUID(value)) {
        return getUuidFieldData(name, value);
      }

      return getTextFieldData(name, value);
    }

    case 'object': {
      if (value instanceof Date) {
        return getDateTimeFieldData(name, value.toISOString());
      }

      if (Array.isArray(value)) {
        return {
          ...getJsonFieldData(name, value),
          elements: getScalarElements(value)
        };
      }

      if (value !== null) {
        return getJsonFieldData(name, value);
      }

      return getNullFieldData(name);
    }

    default:
      throw new UnsupportedFieldTypeError(name, typeof value);
  }
};

const getScalarElements = (values: unknown[]) => {
  const elements: unknown[] = [];

  for (const value of values) {
    if (value instanceof Date) {
      elements.push(value.toISOString());
      continue;
    }

    if (value !== null && typeof value === 'object') {
      return undefined;
    }

    elements.push(value);
  }

  return elements;
};

const getBooleanFieldData = (name: string, value: boolean): FieldParameter => {
  return {
    name,
    type: 'boolean',
    value
  };
};

const getIntegerFieldData = (name: string, value: number): FieldParameter => {
  return {
    name,
    type: 'bigint',
    value
  };
};

const getDecimalFieldData = (name: string, value: number): FieldParameter => {
  return {
    name,
    type: 'decimal',
    value
  };
};

const getTextFieldData = (name: string, value: string): FieldParameter => {
  return {
    name,
    type: 'text',
    value
  };
};

const getUuidFieldData = (name: string, value: string): FieldParameter => {
  return {
    ...getTextFieldData(name, value),
    type: 'uuid'
  };
};

const getDateFieldData = (name: string, value: string): FieldParameter => {
  return {
    ...getTextFieldData(name, value),
    type: 'date'
  };
};

const getTimeFieldData = (name: string, value: string): FieldParameter => {
  return {
    ...getTextFieldData(name, value),
    type: 'time'
  };
};

const getDateTimeFieldData = (name: string, value: string): FieldParameter => {
  return {
    ...getTextFieldData(name, new Date(value).toISOString()),
    type: 'timestamp'
  };
};

const getJsonFieldData = (name: string, value: unknown): FieldParameter => {
  return {
    ...getTextFieldData(name, JSON.stringify(value)),
    type: 'jsonb'
  };
};

const getNullFieldData = (name: string): FieldParameter => {
  return {
    name,
    value: null
  };
};

const getNumberFieldData = (name: string, value: number, format?: string): FieldParameter => {
  if (format === 'integer') {
    return getIntegerFieldData(name, value);
  }

  return getDecimalFieldData(name, value);
};

const getStringFieldData = (name: string, value: string, format?: string): FieldParameter => {
  switch (format) {
    case 'uuid':
      return getUuidFieldData(name, value);

    case 'time':
      return getTimeFieldData(name, value);

    case 'date':
      return getDateFieldData(name, value);

    case 'date-time':
      return getDateTimeFieldData(name, value);

    default:
      return getTextFieldData(name, value);
  }
};
