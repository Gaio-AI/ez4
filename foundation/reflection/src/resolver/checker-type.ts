import type { Node, TypeNode, StringLiteralType, NumberLiteralType, Symbol, TupleTypeReference, Type, TypeReference } from 'typescript';
import type { EveryMemberType, EveryType } from '../types';
import type { Context, State } from './common';

import {
  ElementFlags,
  forEachChild,
  isEnumMember,
  isTypeAliasDeclaration,
  isTypeReferenceNode,
  isThisTypeNode,
  SignatureKind,
  SymbolFlags,
  TypeFlags
} from 'typescript';

import { TypeName } from '../types';
import { isOptional } from '../utils';
import { isInternalType, getNodeFilePath, getNodeFilePosition } from '../helpers/node';
import { getNodeDocumentation } from '../helpers/documentation';
import { isReferenceModel, tryModelReference } from './model-reference';
import { tryEnumReference } from './enum-reference';
import { createProperty, isModelProperty } from './model-property';
import { createIntersection } from './type-intersection';
import { createUndefined } from './type-undefined';
import { createUnknown } from './type-unknown';
import { createBoolean } from './type-boolean';
import { createString } from './type-string';
import { createNumber } from './type-number';
import { createObject } from './type-object';
import { createUnion } from './type-union';
import { createArray } from './type-array';
import { createTuple } from './type-tuple';
import { createNever } from './type-never';
import { createNull } from './type-null';
import { createVoid } from './type-void';
import { createAny } from './type-any';
import { getNewState } from './common';
import { tryTypes } from './types';

type ConversionCache = Map<Type, EveryType | undefined>;

const UNREPRESENTABLE_FLAGS =
  TypeFlags.TypeParameter |
  TypeFlags.Conditional |
  TypeFlags.Substitution |
  TypeFlags.Index |
  TypeFlags.IndexedAccess |
  TypeFlags.TemplateLiteral |
  TypeFlags.StringMapping |
  TypeFlags.BigInt |
  TypeFlags.BigIntLiteral |
  TypeFlags.ESSymbolLike;

const aliasesInProgress = new Set<Node>();

export const bindInstanceType = (state: State, node: Node, type: Type | undefined): State => {
  return { ...state, instance: type && { node, type } };
};

export const rebindInstanceType = (state: State, from: Node, to: Node): State => {
  return state.instance?.node === from ? bindInstanceType(state, to, state.instance.type) : state;
};

export const getBoundInstanceType = (node: Node, state: State) => {
  return state.instance?.node === node ? state.instance.type : undefined;
};

/**
 * Instantiated type for the given node: the one bound by the enclosing generic instantiation,
 * or the declared type when the node doesn't depend on any outer type parameter.
 */
export const getInstanceType = (node: Node, context: Context, state: State) => {
  const boundType = getBoundInstanceType(node, state);

  if (boundType || isOpenNode(node, context)) {
    return boundType;
  }

  return context.checker.getTypeFromTypeNode(node as TypeNode);
};

export const tryInstanceType = (node: Node, context: Context, state: State) => {
  const type = getInstanceType(node, context, state);

  return type && tryCheckerType(type, context);
};

export const tryCheckerType = (type: Type, context: Context, cache: ConversionCache = new Map()): EveryType | undefined => {
  if (cache.has(type)) {
    return cache.get(type);
  }

  const { checker } = context;
  const { flags } = type;

  if (flags & UNREPRESENTABLE_FLAGS) {
    return undefined;
  }

  const aliasType = tryAliasType(type, context);

  if (aliasType) {
    return aliasType;
  }

  if (flags & TypeFlags.Any) {
    return checker.typeToString(type) === 'any' ? emit(createAny(), context.events.onTypeAny) : undefined;
  }

  if (flags & TypeFlags.Unknown) {
    return emit(createUnknown(), context.events.onTypeUnknown);
  }

  if (flags & TypeFlags.Never) {
    return emit(createNever(), context.events.onTypeNever);
  }

  if (flags & TypeFlags.Void) {
    return emit(createVoid(), context.events.onTypeVoid);
  }

  if (flags & TypeFlags.Undefined) {
    return emit(createUndefined(), context.events.onTypeUndefined);
  }

  if (flags & TypeFlags.Null) {
    return emit(createNull('literal', true), context.events.onTypeNull);
  }

  if (flags & TypeFlags.EnumLike) {
    return tryEnumType(type, context);
  }

  if (flags & TypeFlags.Boolean) {
    return emit(createBoolean(), context.events.onTypeBoolean);
  }

  if (flags & TypeFlags.BooleanLiteral) {
    return emit(createBoolean('literal', checker.typeToString(type) === 'true'), context.events.onTypeBoolean);
  }

  if (flags & TypeFlags.String) {
    return emit(createString(), context.events.onTypeString);
  }

  if (flags & TypeFlags.StringLiteral) {
    return emit(createString('literal', (type as StringLiteralType).value), context.events.onTypeString);
  }

  if (flags & TypeFlags.Number) {
    return emit(createNumber(), context.events.onTypeNumber);
  }

  if (flags & TypeFlags.NumberLiteral) {
    return emit(createNumber('literal', (type as NumberLiteralType).value), context.events.onTypeNumber);
  }

  if (type.isUnion()) {
    return tryUnionType(type.types, context, cache);
  }

  if (type.isIntersection()) {
    const elements = convertAll(type.types, context, cache);

    return elements.length ? emit(createIntersection(undefined, undefined, elements), context.events.onTypeIntersection) : undefined;
  }

  if (flags & TypeFlags.Object) {
    return tryObjectType(type, context, cache);
  }

  return undefined;
};

const emit = <T extends EveryType>(type: T, event?: (type: T) => EveryType | null) => {
  return (event ? event(type) : type) ?? undefined;
};

const convertAll = (types: readonly Type[], context: Context, cache: ConversionCache) => {
  return types.map((type) => tryCheckerType(type, context, cache)).filter((type) => !!type);
};

// Non-generic aliases go through the syntactic resolver so ez4 rich types keep their declared shape.
const tryAliasType = (type: Type, context: Context) => {
  const declaration = type.aliasSymbol?.declarations?.at(0);

  if (!declaration || type.aliasTypeArguments?.length || !isTypeAliasDeclaration(declaration)) {
    return undefined;
  }

  if (isInternalType(declaration) || aliasesInProgress.has(declaration)) {
    return undefined;
  }

  aliasesInProgress.add(declaration);

  try {
    return tryTypes(declaration.type, context, getNewState()) ?? undefined;
  } finally {
    aliasesInProgress.delete(declaration);
  }
};

const tryEnumType = (type: Type, context: Context) => {
  const declaration = type.symbol?.declarations?.at(0);

  if (!declaration) {
    return undefined;
  }

  if (isEnumMember(declaration)) {
    return tryEnumReference(declaration, context);
  }

  return tryModelReference(declaration, context) ?? undefined;
};

const tryUnionType = (types: readonly Type[], context: Context, cache: ConversionCache) => {
  const booleans = types.filter((type) => type.flags & TypeFlags.BooleanLiteral);
  const collapsed = booleans.length === 2 ? types.filter((type) => !booleans.includes(type)) : types;

  const elements = convertAll(collapsed, context, cache);

  if (collapsed !== types) {
    elements.push(emit(createBoolean(), context.events.onTypeBoolean) ?? createBoolean());
  }

  if (!elements.length) {
    return undefined;
  }

  // Checker unions are ordered by type id, keep nullish members last like hand-written unions.
  const isNullish = (element: EveryType) => element.type === TypeName.Null || element.type === TypeName.Undefined;

  return createUnion([...elements.filter((element) => !isNullish(element)), ...elements.filter(isNullish)]);
};

const tryObjectType = (type: Type, context: Context, cache: ConversionCache) => {
  const { checker } = context;

  if (checker.isArrayType(type)) {
    const [elementType] = checker.getTypeArguments(type as TypeReference);
    const element = elementType && tryCheckerType(elementType, context, cache);

    return element && createArray(element, {});
  }

  if (checker.isTupleType(type)) {
    const { elementFlags } = (type as TupleTypeReference).target;

    if (elementFlags.some((flag) => flag !== ElementFlags.Required)) {
      return undefined;
    }

    const elementTypes = checker.getTypeArguments(type as TypeReference);
    const elements = convertAll(elementTypes, context, cache);

    return elements.length === elementTypes.length ? createTuple(elements, {}) : undefined;
  }

  const declaration = type.symbol?.declarations?.at(0);

  if (declaration && isReferenceModel(declaration)) {
    const generic = 'typeParameters' in declaration && !!declaration.typeParameters?.length;

    if (!generic) {
      return tryModelReference(declaration, context) ?? undefined;
    }

    if (isInternalType(declaration)) {
      return undefined;
    }
  }

  const hasSignatures =
    checker.getSignaturesOfType(type, SignatureKind.Call).length || checker.getSignaturesOfType(type, SignatureKind.Construct).length;

  if (hasSignatures || checker.getIndexInfosOfType(type).length) {
    return undefined;
  }

  const location = declaration && context.options.includeLocation && !isInternalType(declaration);

  const objectType = createObject(
    location ? getNodeFilePath(declaration) : undefined,
    location ? getNodeFilePosition(declaration) : undefined
  );

  cache.set(type, objectType);

  const members = getObjectMembers(type, context, cache);

  if (!members) {
    cache.set(type, undefined);
    return undefined;
  }

  if (members.length) {
    objectType.members = members;
  }

  const result = emit(objectType, context.events.onTypeObject);

  cache.set(type, result);

  return result;
};

// A partially converted object would silently change its shape (e.g. `client: HttpClient<T>` becoming `{}`),
// so an object with any member that can't be represented is dropped as a whole.
const getObjectMembers = (type: Type, context: Context, cache: ConversionCache) => {
  const members: EveryMemberType[] = [];

  for (const property of context.checker.getPropertiesOfType(type)) {
    const value = !(property.flags & SymbolFlags.Method) && tryCheckerType(context.checker.getTypeOfSymbol(property), context, cache);

    if (!value) {
      return undefined;
    }

    members.push(createObjectProperty(property, value, context));
  }

  return members;
};

const createObjectProperty = (property: Symbol, value: EveryType, context: Context) => {
  const declaration = property.declarations?.at(0);

  const documentation = declaration && isModelProperty(declaration) ? getNodeDocumentation(declaration.name, context.checker) : undefined;

  const optional = !!(property.flags & SymbolFlags.Optional);

  const propertyValue = !optional || isOptional(value) ? value : createUnion([value, createUndefined()]);

  return createProperty(property.name, propertyValue, undefined, documentation?.description, documentation?.tags);
};

/**
 * Determines whether the node depends on a type parameter declared outside of it, in which case
 * the checker can only give its deferred (uninstantiated) type.
 */
const isOpenNode = (root: Node, context: Context) => {
  const visit = (node: Node): boolean => {
    if (isThisTypeNode(node)) {
      return true;
    }

    if (isTypeReferenceNode(node)) {
      const symbol = context.checker.getSymbolAtLocation(node.typeName);

      if (symbol && symbol.flags & SymbolFlags.TypeParameter) {
        const declaration = symbol.declarations?.at(0);

        if (
          !declaration ||
          declaration.getSourceFile() !== root.getSourceFile() ||
          declaration.pos < root.pos ||
          declaration.end > root.end
        ) {
          return true;
        }
      }
    }

    return !!forEachChild(node, (child) => visit(child) || undefined);
  };

  return visit(root);
};
