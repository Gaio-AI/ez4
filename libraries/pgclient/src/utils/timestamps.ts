import type { TableTimestamps } from '@ez4/database/library';
import type { ObjectSchema } from '@ez4/schema';
import type { AnyObject } from '@ez4/utils';

import { isStringSchema } from '@ez4/schema';
import { isAnyString } from '@ez4/utils';

/**
 * The timestamp columns of a table, which the database writes on its own.
 */
export const getTimestampColumns = (timestamps: TableTimestamps | undefined) => {
  return [timestamps?.created, timestamps?.updated].filter(isAnyString);
};

/**
 * The schema a table inserts with. A timestamp is optional and has no default of its own, so a record without it
 * passes validation and leaves the column out of the insert, where the database writes it.
 */
export const getInsertSchema = (schema: ObjectSchema, timestamps: TableTimestamps | undefined): ObjectSchema => {
  const columns = getTimestampColumns(timestamps);

  if (!columns.length) {
    return schema;
  }

  const properties = { ...schema.properties };

  for (const column of columns) {
    const columnSchema = properties[column];

    if (!columnSchema || !isStringSchema(columnSchema)) {
      continue;
    }

    const { default: _default, ...definitions } = columnSchema.definitions ?? {};

    properties[column] = {
      ...columnSchema,
      optional: true,
      ...(columnSchema.definitions && { definitions })
    };
  }

  return {
    ...schema,
    properties
  };
};

/**
 * The data of an update without the timestamps: the database writes the update timestamp, and the creation one
 * doesn't change.
 */
export const omitTimestamps = <T extends AnyObject>(data: T, timestamps: TableTimestamps | undefined): T => {
  const columns = getTimestampColumns(timestamps);

  if (!columns.length) {
    return data;
  }

  const record: AnyObject = { ...data };

  for (const column of columns) {
    delete record[column];
  }

  return record as T;
};
