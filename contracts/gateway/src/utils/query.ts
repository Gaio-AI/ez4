import type { ValidationCustomHandler } from '@ez4/validator';
import type { ObjectSchema } from '@ez4/schema';
import type { Http } from '../services/http/contract';

import { createTransformContext, transform } from '@ez4/transform';
import { validate, createValidatorContext, getErrorDetails } from '@ez4/validator';
import { HttpBadRequestError } from '@ez4/gateway';
import { SchemaType } from '@ez4/schema';

const NO_QUERY_SCHEMA: ObjectSchema = {
  type: SchemaType.Object,
  properties: {}
};

/**
 * Reject the query strings the given schema doesn't declare, when the `strictQueryStrings` preference is on.
 *
 * @throws HttpBadRequestError when a query string isn't declared.
 */
export const assertQueryStrings = async (
  input: Http.QueryStrings,
  schema: ObjectSchema | null | undefined,
  preferences?: Http.Preferences | null
): Promise<void> => {
  if (!preferences?.strictQueryStrings) {
    return;
  }

  const inputStyle = preferences.namingStyle;

  // The transform drops the names the schema doesn't declare, so the check runs over the input as it comes.
  // At depth zero the validator compares only the names (in the input style), without reading any value.
  const validationContext = createValidatorContext({
    property: '$query',
    pathStyle: inputStyle,
    inputStyle,
    depth: 0
  });

  const validationErrors = await validate(input, schema ?? NO_QUERY_SCHEMA, validationContext);

  if (validationErrors.length) {
    throw new HttpBadRequestError('Malformed query strings.', {
      details: getErrorDetails(validationErrors)
    });
  }
};

export const resolveQueryStrings = async <T extends Http.QueryStrings>(
  input: T,
  schema: ObjectSchema,
  preferences?: Http.Preferences,
  onCustomValidation?: ValidationCustomHandler
): Promise<T> => {
  const inputStyle = preferences?.namingStyle;

  const transformContext = createTransformContext({
    convert: true,
    inputStyle
  });

  const payload = transform(input, schema, transformContext);

  const validationContext = createValidatorContext({
    property: '$query',
    pathStyle: inputStyle,
    onCustomValidation
  });

  const validationErrors = await validate(payload, schema, validationContext);

  if (validationErrors.length) {
    throw new HttpBadRequestError('Malformed query strings.', {
      details: getErrorDetails(validationErrors)
    });
  }

  return payload as T;
};
