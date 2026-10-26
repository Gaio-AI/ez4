import { UnsupportedSqlDataError } from '../errors/data';

export const escapeSqlNames = (names: string[]) => {
  return names.map((name) => escapeSqlName(name)).join(', ');
};

export const escapeSqlName = (name: string) => {
  return name === '*' ? name : `"${name.replaceAll('"', '""')}"`;
};

export const escapeSqlText = (text: string) => {
  return `'${text.replaceAll("'", `''`)}'`;
};

/**
 * Write a `text[]` literal of the given items, such as the path of a JSON key.
 *
 * Each item is quoted, so a comma or a brace stays part of it instead of splitting the array, and the backslash
 * and double quote it may have are escaped as the array syntax asks. The literal is meant to be bound as a value:
 * written into the statement, its backslashes would reach the Data API.
 */
export const getSqlTextArray = (items: string[]) => {
  return `{${items.map((item) => `"${item.replaceAll(/[\\"]/g, '\\$&')}"`).join(',')}}`;
};

/**
 * Escape a JSON key written into a statement that may also carry parameters.
 *
 * The Data API reads a backslash before a quote as an escaped quote and then loses every parameter after it,
 * so a key never puts a backslash in the statement: each one is written as `chr(92)`, which keeps the key a
 * text expression that Postgres still folds into a constant.
 */
export const escapeSqlKey = (key: string) => {
  if (!key.includes('\\')) {
    return escapeSqlText(key);
  }

  const tokens = [];

  for (const [index, part] of key.split('\\').entries()) {
    if (index > 0) {
      tokens.push('chr(92)');
    }

    if (part) {
      tokens.push(escapeSqlText(part));
    }
  }

  return `(${tokens.join(' || ')})`;
};

export const escapeSqlData = (data: unknown) => {
  switch (typeof data) {
    case 'number':
    case 'boolean':
      return data;

    case 'string':
      return escapeSqlText(data);

    case 'object':
      return escapeSqlText(JSON.stringify(data));

    default:
      throw new UnsupportedSqlDataError();
  }
};
