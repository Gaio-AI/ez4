import type { AllType, ReflectionTypes } from '@ez4/reflection';
import type { ObjectSchema, ObjectSchemaProperties } from '../types/type-object';
import type { EnumSchema } from '../types/type-enum';
import type { ScalarSchema } from '../types/type-scalar';
import type { AnySchema } from '../types/type-any';

import { deepMerge } from '@ez4/utils';

import { createSchemaContext } from '../types/context';
import { isObjectSchema } from '../types/type-object';
import { isUnionSchema } from '../types/type-union';
import { isEnumSchema } from '../types/type-enum';
import { isScalarSchema } from '../types/type-scalar';
import { isRichTypeIntersection } from './object';
import { createUnionSchema } from './union';
import { getAnySchema } from './any';
import { InvalidSchemaIntersection } from '../errors/intersection';

export const getIntersectionSchema = (
  type: AllType,
  reflection: ReflectionTypes,
  context = createSchemaContext(),
  description?: string
): AnySchema | null => {
  if (!isRichTypeIntersection(type)) {
    return null;
  }

  let intersectionType: AnySchema | null = null;

  for (const element of type.elements) {
    const elementSchema = getAnySchema(element, reflection, context, description);

    if (!elementSchema) {
      continue;
    }

    if (!intersectionType) {
      intersectionType = deepMerge(elementSchema, { definitions: type.definitions });
      continue;
    }

    intersectionType = intersectSchemas(intersectionType, elementSchema);
  }

  return intersectionType;
};

/**
 * Intersect two schemas with TypeScript's `&` semantics: a union distributes over the other side,
 * object properties present on both sides intersect recursively and enum options keep only the
 * values both sides accept (an enum and one of its literals give the literal). Anything else merges as before (definitions such as custom validation
 * `types` are combined).
 *
 * Conflicts TypeScript reduces to `never` keep the previous behaviour inside a property (the
 * later side wins, e.g. `{ foo: number } & { foo: string }`); only the top-level elements refuse
 * to intersect different types.
 */
const intersectSchemas = (target: AnySchema, source: AnySchema, nested = false): AnySchema => {
  if (isUnionSchema(target)) {
    return createUnionSchema({ ...target, elements: target.elements.map((element) => intersectSchemas(element, source, nested)) });
  }

  if (isUnionSchema(source)) {
    return createUnionSchema({ ...source, elements: source.elements.map((element) => intersectSchemas(target, element, nested)) });
  }

  if (target.type !== source.type) {
    const literal = intersectEnumLiteral(target, source) ?? intersectEnumLiteral(source, target);

    if (literal) {
      return literal;
    }

    if (nested) {
      return deepMerge(target, source, { array: true });
    }

    throw new InvalidSchemaIntersection(target.type, source.type);
  }

  if (isObjectSchema(target) && isObjectSchema(source)) {
    return intersectObjects(target, source);
  }

  if (isEnumSchema(target) && isEnumSchema(source)) {
    return intersectEnums(target, source);
  }

  return deepMerge(target, source, { array: true });
};

const intersectObjects = (target: ObjectSchema, source: ObjectSchema): ObjectSchema => {
  const merged = deepMerge(target, { ...source, properties: {} }, { array: true });
  const properties: ObjectSchemaProperties = { ...target.properties };

  for (const name in source.properties) {
    const targetProperty = target.properties[name];
    const sourceProperty = source.properties[name];

    properties[name] = targetProperty ? intersectSchemas(targetProperty, sourceProperty, true) : sourceProperty;
  }

  return { ...merged, properties };
};

const intersectEnums = (target: EnumSchema, source: EnumSchema): EnumSchema => {
  const merged = deepMerge(target, source, { array: true });
  const accepted = new Set(source.options.map(({ value }) => value));
  const options = target.options.filter(({ value }) => accepted.has(value));

  // Disjoint options are `never` in TypeScript; keep the previous (merged) options rather than an
  // enum nothing can satisfy.
  return options.length ? { ...merged, options } : merged;
};

/**
 * An enum intersected with one of its own literals is that literal (`Kind & 'audio'` is `'audio'`).
 */
const intersectEnumLiteral = (target: AnySchema, source: AnySchema): ScalarSchema | undefined => {
  if (!isEnumSchema(target) || !isScalarSchema(source)) {
    return undefined;
  }

  const literal = source.definitions?.value;

  if (literal === undefined || !target.options.some(({ value }) => value === literal)) {
    return undefined;
  }

  return source;
};
