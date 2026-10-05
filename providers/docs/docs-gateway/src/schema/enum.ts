import type { EnumSchema } from '@ez4/schema';

import { isAnyNumber } from '@ez4/utils';

import { getIndentedOutput, getMultilineOutput } from '../utils/format';

export const getEnumSchemaOutput = (schema: EnumSchema) => {
  const optionsOutput = [];
  const optionTypes = new Set<string>();

  for (const option of schema.options) {
    if (!isAnyNumber(option.value)) {
      optionsOutput.push(`- "${getMultilineOutput(option.value)}"`);
      optionTypes.add('string');
    } else {
      optionsOutput.push(`- ${option.value}`);
      optionTypes.add('number');
    }
  }

  if (!schema.nullable) {
    return ['enum:', ...getIndentedOutput(optionsOutput)];
  }

  // Code generators such as Orval drop the null of an enum without a type, so a nullable enum names its types too.
  const typeOutput = `type: [${[...optionTypes, `'null'`].join(', ')}]`;

  return [typeOutput, 'enum:', ...getIndentedOutput([...optionsOutput, '- null'])];
};
