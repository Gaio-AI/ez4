import type { Node, TypeQueryNode } from 'typescript';
import type { Context, State } from './common';

import { isTypeQueryNode, TypeFlags } from 'typescript';

import { getNodeTypeDeclaration } from '../helpers/declaration';
import { tryModelReference } from './model-reference';
import { tryTypeCallback } from './type-callback';
import { tryCheckerType } from './checker-type';

export const isTypeOf = (node: Node): node is TypeQueryNode => {
  return isTypeQueryNode(node);
};

export const tryTypeOf = (node: Node, context: Context, state: State) => {
  if (!isTypeOf(node)) {
    return undefined;
  }

  const literal = tryLiteralConstant(node, context);

  if (literal) {
    return literal;
  }

  const declaration = getNodeTypeDeclaration(node.exprName, context.checker);

  if (!declaration) {
    return undefined;
  }

  return tryModelReference(declaration, context) || tryTypeCallback(declaration, context, state);
};

/**
 * `typeof MaxLength` of a `const MaxLength = 1000` is its literal type, `1000`.
 */
const tryLiteralConstant = (node: TypeQueryNode, context: Context) => {
  const type = context.checker.getTypeAtLocation(node);

  if (type.isLiteral() || type.flags & TypeFlags.BooleanLiteral) {
    return tryCheckerType(type, context);
  }

  return undefined;
};
