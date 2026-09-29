import type { IndexedAccessTypeNode, Node, NodeArray, TypeNode } from 'typescript';
import type { Context, State } from './common';

import { isIndexedAccessTypeNode, SyntaxKind } from 'typescript';

import { isTypeReference } from '../types/type-reference';
import { isTypeArray } from '../types/type-array';
import { isTypeTuple } from '../types/type-tuple';
import { getPropertyName } from '../helpers/identifier';
import { tryTypeReference } from './type-reference';
import { createUnion } from './type-union';
import { tryInstanceType } from './checker-type';

export type TypeArguments = NodeArray<TypeNode>;

export const isIndexReference = (node: Node): node is IndexedAccessTypeNode => {
  return isIndexedAccessTypeNode(node);
};

export const tryIndexReference = (node: Node, context: Context, state: State) => {
  if (!isIndexReference(node)) {
    return undefined;
  }

  const reflectedType = tryTypeReference(node.objectType, context, state);

  if (reflectedType && node.indexType.kind === SyntaxKind.NumberKeyword) {
    if (isTypeArray(reflectedType)) {
      return reflectedType.element;
    }

    if (isTypeTuple(reflectedType)) {
      return createUnion(reflectedType.elements);
    }
  }

  if (reflectedType === undefined) {
    return tryInstanceType(node, context, state);
  }

  if (!reflectedType || !isTypeReference(reflectedType)) {
    return (reflectedType && tryInstanceType(node, context, state)) ?? reflectedType;
  }

  const index = getPropertyName(node.indexType, context.checker);

  return {
    ...reflectedType,
    index
  };
};
