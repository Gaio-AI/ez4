import type { NamingStyle, ObjectSchema } from '@ez4/schema';
import type { SchemaOutputContext } from '../utils/reference';

import { getPropertyName } from '@ez4/schema';

import { getCommonSchemaOutput, getTypeOutput } from '../utils/schema';
import { getChildSchemaOutputContext } from '../utils/reference';
import { getIndentedOutput, getNameOutput } from '../utils/format';
import { getAnySchemaOutput } from '../schema/any';

export const getObjectSchemaOutput = (schema: ObjectSchema, namingStyle?: NamingStyle, context?: SchemaOutputContext) => {
  if (schema.definitions?.encoded) {
    return [getTypeOutput('string', schema), ...getCommonSchemaOutput(schema), 'format: byte'];
  }

  if (context && schema.identity) {
    context.identities.set(schema.identity, context.pointer);
  }

  const output = [
    getTypeOutput('object', schema),
    ...getCommonSchemaOutput(schema),
    `additionalProperties: ${!!schema.definitions?.extensible}`
  ];

  const requiredProperties = [];
  const propertiesOutput = [];

  for (const propertyKey in schema.properties) {
    const propertySchema = schema.properties[propertyKey];
    const propertyName = getPropertyName(propertyKey, namingStyle);
    const propertyOutput = getNameOutput(propertyName);

    // A nullable property is still sent, with null: only an optional one can be left out.
    if (!propertySchema.optional) {
      requiredProperties.push(`- ${propertyOutput}`);
    }

    const propertyContext = getChildSchemaOutputContext(context, 'properties', propertyName);
    const schemaOutput = getAnySchemaOutput(propertySchema, namingStyle, propertyContext);

    if (schemaOutput.length) {
      propertiesOutput.push(`${propertyOutput}:`, ...getIndentedOutput(schemaOutput));
    } else {
      propertiesOutput.push(`${propertyOutput}: true`);
    }
  }

  if (propertiesOutput.length) {
    output.push('properties:', ...getIndentedOutput(propertiesOutput));
  }

  if (requiredProperties.length) {
    output.push('required:', ...getIndentedOutput(requiredProperties));
  }

  return output;
};
