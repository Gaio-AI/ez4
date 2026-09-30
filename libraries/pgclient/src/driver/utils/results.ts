import type { QueryResult } from 'pg';

import { InternalFailure, UnsupportedResultException } from '@ez4/pgclient';
import { types } from 'pg';

type ValueParser = (value: string) => unknown;

const MAX_RESULT_SIZE = 1048576;

const enum PgType {
  Bool = 16,
  Int8 = 20,
  Int2 = 21,
  Int4 = 23,
  Json = 114,
  Float4 = 700,
  Float8 = 701,
  BoolArray = 1000,
  Int2Array = 1005,
  Int4Array = 1007,
  TextArray = 1009,
  BpcharArray = 1014,
  VarcharArray = 1015,
  Int8Array = 1016,
  Float4Array = 1021,
  Float8Array = 1022,
  Date = 1082,
  Time = 1083,
  Timestamp = 1114,
  TimestampArray = 1115,
  DateArray = 1182,
  TimeArray = 1183,
  TimestampTz = 1184,
  TimestampTzArray = 1185,
  Interval = 1186,
  NumericArray = 1231,
  TimeTz = 1266,
  Numeric = 1700,
  UuidArray = 2951,
  Jsonb = 3802
}

const TIMESTAMP_TZ_PATTERN = /^(\d{4,})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?([+-])(\d{2})(?::(\d{2}))?(?::(\d{2}))?$/;

const FRACTION_PATTERN = /\.(\d+)$/;

const ARRAY_ELEMENT_PATTERN = /"((?:[^"\\]|\\.)*)"|([^,{}"]+)|([{}])/g;

export const createResultTypes = (parseJson: boolean) => {
  let fieldBytes = 0;

  return {
    getFieldBytes: () => fieldBytes,
    getTypeParser: (type: number) => {
      const parseValue = getValueParser(type, parseJson);

      return (value: string) => {
        fieldBytes += Buffer.byteLength(value);

        return parseValue(value);
      };
    }
  };
};

export const assertSupportedResult = (result: QueryResult, fieldBytes: number) => {
  for (const { dataTypeID } of result.fields) {
    const typeName = UNSUPPORTED_TYPES[dataTypeID];

    if (typeName) {
      throw new UnsupportedResultException(`The result contains the unsupported data type ${typeName}.`);
    }
  }

  // Every row goes on the wire with its column count and one length per column besides the field octets.
  const resultSize = result.rows.length * (2 + 4 * result.fields.length) + fieldBytes;

  if (resultSize > MAX_RESULT_SIZE) {
    throw new UnsupportedResultException('The result exceeds the size limit 1 MB.');
  }
};

const getValueParser = (type: number, parseJson: boolean): ValueParser => {
  // The Data API driver parses json only when it reads the column types, which statements with metadata don't request.
  if (type === PgType.Json || type === PgType.Jsonb) {
    return parseJson ? parseJsonValue : parseTextValue;
  }

  return VALUE_PARSERS[type] ?? types.getTypeParser(type);
};

const parseTextValue = (value: string) => {
  return value;
};

const parseJsonValue = (value: string) => {
  return JSON.parse(value);
};

const parseBooleanValue = (value: string) => {
  return value === 't';
};

const parseNumberValue = (value: string) => {
  return Number(value);
};

// Time and timestamp values share the trailing seconds fraction.
const parseTimeValue = (value: string) => {
  return value.replace(FRACTION_PATTERN, (_match, fraction: string) => formatFraction(fraction));
};

const parseTimestampTzValue = (value: string) => {
  if (value === 'infinity' || value === '-infinity') {
    throw new InternalFailure(`The result contains the infinite timestamp '${value}'.`);
  }

  const match = TIMESTAMP_TZ_PATTERN.exec(value);

  if (!match) {
    return value;
  }

  const [, year, month, day, hours, minutes, seconds, fraction, sign, offsetHours, offsetMinutes = '0', offsetSeconds = '0'] = match;

  const offset = Number(offsetHours) * 3600 + Number(offsetMinutes) * 60 + Number(offsetSeconds);

  const timestamp = new Date(0);

  // Unlike Date.UTC, setUTCFullYear keeps the years before 100.
  timestamp.setUTCFullYear(Number(year), Number(month) - 1, Number(day));
  timestamp.setUTCHours(Number(hours), Number(minutes), Number(seconds) + (sign === '-' ? offset : -offset));

  return `${formatUtcDate(timestamp)} ${formatUtcTime(timestamp)}${formatFraction(fraction)}`;
};

const parseArrayValue = (value: string, parseElement: ValueParser) => {
  const root: unknown[] = [];
  const parents: unknown[][] = [];

  let current = root;

  // Arrays with custom bounds start with a dimension decoration, such as "[0:1]=".
  const elements = value.substring(value.indexOf('{')).matchAll(ARRAY_ELEMENT_PATTERN);

  for (const [, quoted, unquoted, brace] of elements) {
    if (brace === '{') {
      const nested: unknown[] = [];

      current.push(nested);
      parents.push(current);

      current = nested;
      continue;
    }

    if (brace === '}') {
      current = parents.pop() ?? root;
      continue;
    }

    if (quoted !== undefined) {
      current.push(parseElement(quoted.replaceAll(/\\(.)/g, '$1')));
      continue;
    }

    current.push(unquoted === 'NULL' ? null : parseElement(unquoted));
  }

  return root[0];
};

const getArrayParser = (parseElement: ValueParser): ValueParser => {
  return (value) => parseArrayValue(value, parseElement);
};

// The Data API prints no fraction when it's zero, milliseconds when they're enough, and microseconds otherwise.
const formatFraction = (fraction = '') => {
  const microseconds = fraction.padEnd(6, '0');

  if (!Number(microseconds)) {
    return '';
  }

  if (microseconds.endsWith('000')) {
    return `.${microseconds.substring(0, 3)}`;
  }

  return `.${microseconds}`;
};

const formatUtcDate = (date: Date) => {
  return `${padNumber(date.getUTCFullYear(), 4)}-${padNumber(date.getUTCMonth() + 1, 2)}-${padNumber(date.getUTCDate(), 2)}`;
};

const formatUtcTime = (date: Date) => {
  return `${padNumber(date.getUTCHours(), 2)}:${padNumber(date.getUTCMinutes(), 2)}:${padNumber(date.getUTCSeconds(), 2)}`;
};

const padNumber = (value: number, length: number) => {
  return value.toString().padStart(length, '0');
};

const VALUE_PARSERS: Record<number, ValueParser | undefined> = {
  [PgType.Bool]: parseBooleanValue,
  [PgType.Int2]: parseNumberValue,
  [PgType.Int4]: parseNumberValue,
  [PgType.Int8]: parseNumberValue,
  [PgType.Numeric]: parseNumberValue,
  [PgType.Float4]: parseNumberValue,
  [PgType.Float8]: parseNumberValue,
  [PgType.Date]: parseTextValue,
  [PgType.Time]: parseTimeValue,
  [PgType.Timestamp]: parseTimeValue,
  [PgType.TimestampTz]: parseTimestampTzValue,
  [PgType.BoolArray]: getArrayParser(parseBooleanValue),
  [PgType.Int2Array]: getArrayParser(parseNumberValue),
  [PgType.Int4Array]: getArrayParser(parseNumberValue),
  [PgType.Int8Array]: getArrayParser(parseNumberValue),
  [PgType.NumericArray]: getArrayParser(parseNumberValue),
  [PgType.Float4Array]: getArrayParser(parseNumberValue),
  [PgType.Float8Array]: getArrayParser(parseNumberValue),
  [PgType.TextArray]: getArrayParser(parseTextValue),
  [PgType.BpcharArray]: getArrayParser(parseTextValue),
  [PgType.VarcharArray]: getArrayParser(parseTextValue),
  [PgType.UuidArray]: getArrayParser(parseTextValue),
  [PgType.DateArray]: getArrayParser(parseTextValue),
  [PgType.TimeArray]: getArrayParser(parseTimeValue),
  [PgType.TimestampArray]: getArrayParser(parseTimeValue),
  [PgType.TimestampTzArray]: getArrayParser(parseTimestampTzValue)
};

const UNSUPPORTED_TYPES: Record<number, string | undefined> = {
  [PgType.Interval]: 'INTERVAL',
  [PgType.TimeTz]: 'TIMETZ'
};
