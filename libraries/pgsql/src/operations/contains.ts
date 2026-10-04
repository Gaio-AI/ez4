import type { AnySchema } from '@ez4/schema';
import type { SqlOperationContext } from './types';

import { SchemaType } from '@ez4/schema';

import { getOperandColumn, getOperandPattern, getOperandValue } from './utils';

export const getContainsOperation = (column: string, schema: AnySchema | undefined, operand: unknown, context: SqlOperationContext) => {
  switch (schema?.type) {
    case SchemaType.Object:
    case SchemaType.Array:
    case SchemaType.Tuple: {
      return `${column} @> ${getOperandValue(schema, operand, context, true)}`;
    }

    default: {
      const rhsOperand = getOperandPattern(schema, operand, context);
      const lhsOperand = getOperandColumn(schema, column, context);

      // The backslash the pattern is escaped with is the default LIKE escape, so no ESCAPE clause is written:
      // the RDS Data API reads the `\'` in `ESCAPE '\'` as an escaped quote and leaves every later parameter
      // of the statement unbound.
      if (context.flags?.insensitive) {
        return `${lhsOperand} ILIKE '%' || ${rhsOperand} || '%'`;
      }

      return `${lhsOperand} LIKE '%' || ${rhsOperand} || '%'`;
    }
  }
};
