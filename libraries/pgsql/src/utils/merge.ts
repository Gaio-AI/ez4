import { escapeSqlKey, escapeSqlName } from './escape';

export const mergeSqlPath = (column: string, path: string | undefined, key = escapeSqlKey(column)) => {
  return path ? `${path}[${key}]` : escapeSqlName(column);
};

export const mergeSqlJsonPath = (column: string, path: string | undefined, text?: boolean, key = escapeSqlKey(column)) => {
  return path ? `${path}${text ? '->>' : '->'}${key}` : escapeSqlName(column);
};

export const mergeSqlAlias = (column: string, alias: string | undefined) => {
  return alias ? `${escapeSqlName(alias)}.${column}` : column;
};
