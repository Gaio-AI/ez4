import type { Node, TypeReferenceNode } from 'typescript';
import type { EveryType } from '../types';
import type { Context, State } from './common';

import { isTypeReferenceNode } from 'typescript';

import { getNodeTypeDeclaration } from '../helpers/declaration';
import { isIndexReference, tryIndexReference } from './index-reference';
import { tryNativeTypeAlias, tryTypeAlias } from './type-alias';
import { tryTypeParameter } from './type-parameter';
import { tryInternalReference } from './internal-reference';
import { tryGenericReference } from './generic-reference';
import { tryModelReference } from './model-reference';
import { tryTypes } from './types';
import { bindInstanceType, getInstanceType, tryCheckerType } from './checker-type';
import { isInternalType } from '../helpers/node';
import { isTypeAlias } from './type-alias';

export const isTypeReference = (node: Node): node is TypeReferenceNode => {
  return isTypeReferenceNode(node);
};

export const tryTypeReference = (node: Node, context: Context, state: State): EveryType | undefined => {
  if (isIndexReference(node)) {
    return tryIndexReference(node, context, state);
  }

  if (!isTypeReference(node)) {
    return undefined;
  }

  const declaration = getNodeTypeDeclaration(node.typeName, context.checker);
  const types = node.typeArguments;

  if (!declaration) {
    return undefined;
  }

  const instanceType = types ? getInstanceType(node, context, state) : undefined;

  if (instanceType && isCheckerAlias(declaration)) {
    const checkerType = tryCheckerType(instanceType, context);

    if (checkerType) {
      return checkerType;
    }
  }

  return (
    tryNativeTypeAlias(declaration, types, context, state) ||
    tryTypeAlias(declaration, types, context, isTypeAlias(declaration) ? bindInstanceType(state, declaration.type, instanceType) : state) ||
    tryTypeParameter(declaration, context, state) ||
    tryInternalReference(declaration, types, context, state) ||
    tryGenericReference(declaration, types, context, bindInstanceType(state, declaration, instanceType)) ||
    tryModelReference(declaration, context) ||
    tryTypes(declaration, context, state)
  );
};

const SYNTACTIC_NATIVE_ALIASES = ['Pick', 'Omit', 'Required', 'Partial'];

// Library aliases other than the ones ez4 resolves syntactically are better resolved by the checker.
const isCheckerAlias = (declaration: Node) => {
  return isTypeAlias(declaration) && isInternalType(declaration) && !SYNTACTIC_NATIVE_ALIASES.includes(declaration.name.text);
};
