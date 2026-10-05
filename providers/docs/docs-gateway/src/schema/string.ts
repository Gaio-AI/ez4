import type { StringSchema } from '@ez4/schema';

import { isAnyNumber } from '@ez4/utils';

import { getCommonSchemaOutput, getConstantOutput, getTypeOutput } from '../utils/schema';
import { getMultilineOutput } from '../utils/format';

export const getStringSchemaOutput = (schema: StringSchema) => {
  const output = [getTypeOutput('string', schema), ...getCommonSchemaOutput(schema)];

  if (schema.format) {
    output.push(`format: ${schema.format}`);
  }

  if (schema.definitions) {
    const { default: defaultValue, minLength, maxLength, pattern, value } = schema.definitions;

    if (value) {
      output.push(getConstantOutput(`"${getMultilineOutput(value)}"`, schema));
    }

    if (defaultValue) {
      output.push(`default: "${getMultilineOutput(defaultValue)}"`);
    }

    if (pattern) {
      output.push(`pattern: "${getMultilineOutput(pattern)}"`);
    }

    if (isAnyNumber(minLength)) {
      output.push(`minLength: ${minLength}`);
    }

    if (isAnyNumber(maxLength)) {
      output.push(`maxLength: ${maxLength}`);
    }
  }

  return output;
};
