import type { Node, TypeReferenceNode } from 'typescript';
import type { EveryType } from '../types';
import type { Context, State } from './common';

import {
  isConditionalTypeNode,
  isMappedTypeNode,
  isNamedTupleMember,
  isParenthesizedTypeNode,
  isRestTypeNode,
  isTemplateLiteralTypeNode,
  isTypeOperatorNode,
  isTypeReferenceNode,
  SyntaxKind
} from 'typescript';

import { tryTypeAny } from './type-any';
import { tryTypeVoid } from './type-void';
import { tryTypeNever } from './type-never';
import { tryTypeUnknown } from './type-unknown';
import { tryTypeUndefined } from './type-undefined';
import { tryTypeNull } from './type-null';
import { tryTypeBoolean } from './type-boolean';
import { tryTypeNumber } from './type-number';
import { tryTypeString } from './type-string';
import { tryTypeObject } from './type-object';
import { tryTypeUnion } from './type-union';
import { tryTypeIntersection } from './type-intersection';
import { tryTypeArray } from './type-array';
import { tryTypeTuple } from './type-tuple';
import { tryTypeReference } from './type-reference';
import { isTypeParameter, tryTypeParameter } from './type-parameter';
import { getNodeTypeDeclaration } from '../helpers/declaration';
import { tryTypeCallback } from './type-callback';
import { tryTypeOf } from './type-of';
import { tryEnumReference } from './enum-reference';
import { tryTypeConditional } from './type-conditional';
import { rebindInstanceType, tryInstanceType } from './checker-type';

export const tryTypes = (node: Node, context: Context, state: State): EveryType | undefined => {
  if (isParenthesizedTypeNode(node)) {
    return tryTypes(node.type, context, rebindInstanceType(state, node, node.type));
  }

  if (isNamedTupleMember(node)) {
    return tryTypes(node.type, context, { ...state, spread: !!node.dotDotDotToken });
  }

  if (isRestTypeNode(node)) {
    return tryTypes(node.type, context, { ...state, spread: true });
  }

  if (isTypeOperatorNode(node) && node.operator === SyntaxKind.ReadonlyKeyword) {
    return tryTypes(node.type, context, rebindInstanceType(state, node, node.type));
  }

  return (
    tryTypeAny(node, context) ||
    tryTypeVoid(node, context) ||
    tryTypeNever(node, context) ||
    tryTypeUnknown(node, context) ||
    tryTypeUndefined(node, context) ||
    tryTypeNull(node, context) ||
    tryTypeBoolean(node, context) ||
    tryTypeNumber(node, context) ||
    tryTypeString(node, context) ||
    tryTypeObject(node, context, state) ||
    tryTypeUnion(node, context, state) ||
    tryTypeIntersection(node, context, state) ||
    tryTypeArray(node, context, state) ||
    tryTypeTuple(node, context, state) ||
    tryTypeReference(node, context, state) ||
    tryTypeParameter(node, context, state) ||
    tryTypeCallback(node, context, state) ||
    tryTypeOf(node, context, state) ||
    tryTypeConditional(node, context, state) ||
    tryEnumReference(node, context) ||
    tryCheckerFallback(node, context, state)
  );
};

// Only constructs without a syntactic resolver, so a type dropped by a resolver event stays dropped.
const isCheckerFallbackNode = (node: Node, context: Context) => {
  return (
    isConditionalTypeNode(node) ||
    isMappedTypeNode(node) ||
    isTypeOperatorNode(node) ||
    isTemplateLiteralTypeNode(node) ||
    (isTypeReferenceNode(node) && isTypeParameterReference(node, context))
  );
};

const isTypeParameterReference = (node: TypeReferenceNode, context: Context) => {
  const declaration = getNodeTypeDeclaration(node.typeName, context.checker);

  return !!declaration && isTypeParameter(declaration);
};

const tryCheckerFallback = (node: Node, context: Context, state: State) => {
  if (!isCheckerFallbackNode(node, context)) {
    return undefined;
  }

  return tryInstanceType(node, context, state);
};
