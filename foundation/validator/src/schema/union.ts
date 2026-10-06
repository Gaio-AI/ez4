import type { AnySchema, EnumSchemaOption, NamingStyle, ObjectSchema, UnionSchema } from '@ez4/schema';
import type { ValidationContext } from '../types/context';

import { getPropertyName, SchemaType } from '@ez4/schema';
import { isAnyObject } from '@ez4/utils';

import { UnexpectedEnumValueError } from '../errors/enum';
import { createValidatorContext } from '../types/context';
import { useCustomValidation } from '../utils/custom';
import { isNullishAllowed } from '../utils/nullish';
import { validateAny } from './any';

export const validateUnion = async (value: unknown, schema: UnionSchema, context = createValidatorContext()) => {
  if (isNullishAllowed(value, schema)) {
    return [];
  }

  const { definitions } = schema;

  const narrowed = narrowByDiscriminators(value, schema.elements, context);

  if (narrowed instanceof Error) {
    return [narrowed];
  }

  let lastErrorList: Error[] = [];
  let lastErrorSize = +Infinity;

  for (const elementSchema of narrowed) {
    const errorList = await validateAny(value, elementSchema, context);
    const errorSize = errorList.length;

    if (errorSize === 0) {
      // A union marked for custom validation (`Validation.Use<...>`) runs it once a branch matches.
      if (definitions?.types && context) {
        return useCustomValidation(value, schema, definitions.types, context);
      }

      return [];
    }

    if (errorSize === lastErrorSize) {
      // Tied branches often fail the same way (e.g. a string where every branch is an object).
      lastErrorList.push(...errorList.filter((error) => !lastErrorList.some((last) => isSameError(last, error))));
      continue;
    }

    if (lastErrorSize > errorSize) {
      lastErrorList = errorList;
      lastErrorSize = errorSize;
    }
  }

  return lastErrorList;
};

const isSameError = (target: Error, source: Error) => {
  return target.constructor === source.constructor && target.message === source.message;
};

type Discriminator = {
  path: string[];
  literals: (string | number | boolean)[];
};

/**
 * Keep only the union branches whose literal properties match the input. A discriminator is a
 * property path holding a literal in every branch, with at least two distinct values across them
 * (`type: 'message' | 'media'`, then `data.media_kind` among the remaining `media` branches).
 * Narrowing repeats until no discriminator is left, so the error report comes from the branches
 * the input actually targets. A discriminator is required in every branch, so an input whose value
 * is missing or matches no branch fails on that property alone. Only an input that is not an
 * object along the path is left to every branch.
 */
const narrowByDiscriminators = (value: unknown, elements: AnySchema[], context: ValidationContext): AnySchema[] | Error => {
  let current = elements;

  for (let discriminator = findDiscriminator(current); discriminator; discriminator = findDiscriminator(current)) {
    const input = readPath(value, discriminator.path, context.inputStyle);

    if (!input.found) {
      return current;
    }

    const { literals } = discriminator;

    const matching = current.filter((_element, index) => literals[index] === input.value);

    if (!matching.length) {
      const options: EnumSchemaOption[] = [...new Set(literals)].map((literal) => ({
        value: typeof literal === 'boolean' ? `${literal}` : literal
      }));
      const property = [context.property, ...discriminator.path.map((key) => getPropertyName(key, context.pathStyle ?? context.inputStyle))]
        .filter(Boolean)
        .join('.');

      return new UnexpectedEnumValueError(input.value, options, property);
    }

    current = matching;
  }

  return current;
};

const findDiscriminator = (elements: AnySchema[], path: string[] = []): Discriminator | undefined => {
  if (elements.length < 2 || !elements.every(isPlainObjectSchema)) {
    return undefined;
  }

  const sharedKeys = Object.keys(elements[0].properties).filter((key) => elements.every((object) => key in object.properties));

  for (const key of sharedKeys) {
    const literals = elements.map((object) => getLiteral(object.properties[key]));

    if (literals.every((literal) => literal !== undefined) && new Set(literals).size > 1) {
      return { path: [...path, key], literals: literals as Discriminator['literals'] };
    }
  }

  for (const key of sharedKeys) {
    const nested = findDiscriminator(
      elements.map((object) => object.properties[key]),
      [...path, key]
    );

    if (nested) {
      return nested;
    }
  }

  return undefined;
};

const isPlainObjectSchema = (schema: AnySchema): schema is ObjectSchema => {
  return schema.type === SchemaType.Object && !schema.optional && !schema.nullable;
};

const getLiteral = (schema: AnySchema) => {
  if (schema.optional || schema.nullable) {
    return undefined;
  }

  if (schema.type === SchemaType.Enum) {
    return schema.options.length === 1 ? schema.options[0].value : undefined;
  }

  if (schema.type === SchemaType.String || schema.type === SchemaType.Number || schema.type === SchemaType.Boolean) {
    return schema.definitions?.value;
  }

  return undefined;
};

const readPath = (value: unknown, path: string[], inputStyle?: NamingStyle) => {
  let current = value;

  for (const key of path) {
    if (!isAnyObject(current)) {
      return { found: false as const };
    }

    current = current[getPropertyName(key, inputStyle)];
  }

  return { found: true as const, value: current };
};
