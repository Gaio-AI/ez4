import { hashData, toSnakeCase } from '@ez4/utils';

/**
 * Postgres truncates a longer identifier to this size (in bytes).
 */
export const MAX_NAME_SIZE = 63;

/**
 * The name an object is built under before it takes the place of the one with the given name. A long
 * name is shortened with a hash of the full one, since the truncation could otherwise cut the temporary
 * marker out and land on the name of the object being replaced.
 */
export const getTemporaryName = (name: string) => {
  const separator = name.lastIndexOf('_');

  const prefix = name.substring(0, separator);
  const suffix = name.substring(separator);

  const temporaryName = `${prefix}_tmp${suffix}`;

  if (Buffer.byteLength(temporaryName) <= MAX_NAME_SIZE) {
    return temporaryName;
  }

  const marker = `_${hashData(name).substring(0, 8)}_tmp${suffix}`;

  return `${clipName(prefix, MAX_NAME_SIZE - Buffer.byteLength(marker))}${marker}`;
};

/**
 * The name as Postgres stores it.
 */
export const getStoredName = (name: string) => {
  return clipName(name, MAX_NAME_SIZE);
};

const clipName = (name: string, size: number) => {
  let result = name;

  while (Buffer.byteLength(result) > size) {
    result = result.substring(0, result.length - 1);
  }

  return result;
};

export const getPrimaryKeyName = (table: string, name: string) => {
  return `${getName(table, name)}_pk`;
};

export const getUniqueKeyName = (table: string, name: string) => {
  return `${getName(table, name)}_uk`;
};

export const getSecondaryKeyName = (table: string, name: string) => {
  return `${getName(table, name)}_sk`;
};

export const getRelationName = (table: string, name: string) => {
  return `${getName(table, name)}_fk`;
};

export const getConstraintName = (table: string, name: string) => {
  return `${getName(table, name)}_ck`;
};

const getName = (table: string, name: string) => {
  return `${table}_${toSnakeCase(name.replaceAll(':', '_'))}`;
};
