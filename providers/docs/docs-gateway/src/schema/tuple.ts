import type { NamingStyle, TupleSchema } from '@ez4/schema';
import type { SchemaOutputContext } from '../utils/reference';

import { getIndentedOutput } from '../utils/format';
import { getCommonSchemaOutput } from '../utils/schema';
import { getChildSchemaOutputContext } from '../utils/reference';
import { getAnySchemaOutput } from './any';

export const getTupleSchemaOutput = (schema: TupleSchema, namingStyle?: NamingStyle, context?: SchemaOutputContext) => {
  const output = ['type: array', ...getCommonSchemaOutput(schema), 'items: false'];

  const elementsOutput = [];

  let elementIndex = 0;

  for (const element of schema.elements) {
    const elementContext = getChildSchemaOutputContext(context, 'prefixItems', elementIndex);
    const schemaOutput = getAnySchemaOutput(element, namingStyle, elementContext);

    if (schemaOutput.length) {
      elementsOutput.push(`- ${schemaOutput.shift()}`, ...getIndentedOutput(schemaOutput));
      elementIndex++;
    }
  }

  if (elementsOutput.length) {
    output.push('prefixItems:', ...getIndentedOutput(elementsOutput));
  }

  return output;
};
