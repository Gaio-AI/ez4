import type { BooleanSchema } from '@ez4/schema';

import { isAnyBoolean } from '@ez4/utils';

import { getCommonSchemaOutput, getConstantOutput, getTypeOutput } from '../utils/schema';

export const getBooleanSchemaOutput = (schema: BooleanSchema) => {
  const output = [getTypeOutput('boolean', schema), ...getCommonSchemaOutput(schema)];

  if (schema.definitions) {
    const { default: defaultValue, value } = schema.definitions;

    if (isAnyBoolean(defaultValue)) {
      output.push(`default: ${defaultValue}`);
    }

    if (isAnyBoolean(value)) {
      output.push(getConstantOutput(`${value}`, schema));
    }
  }

  return output;
};
