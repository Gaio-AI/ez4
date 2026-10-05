import type { SqlOperationContext } from './types';

import { escapeSqlKey } from '../utils/escape';
import { getIsNullOperation } from './is-null';

export const getIsMissingOperation = (column: string, operand: unknown, context: SqlOperationContext) => {
  if (!context.path || !context.field) {
    return getIsNullOperation(column, operand);
  }

  if (operand) {
    return `NOT (${context.path} ? ${escapeSqlKey(context.field)})`;
  }

  return `${context.path} ? ${escapeSqlKey(context.field)}`;
};
