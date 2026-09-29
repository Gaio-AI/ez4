import type { ConditionalTypeNode, Node } from 'typescript';
import type { EveryType } from '../types';
import type { Context, State } from './common';

import { isConditionalTypeNode, isTypeReferenceNode } from 'typescript';

import { TypeName } from '../types';
import { getNodeTypeDeclaration } from '../helpers/declaration';
import { isTypeParameter } from './type-parameter';
import { createUnion } from './type-union';
import { createBoolean } from './type-boolean';
import { getNewState } from './common';
import { tryTypes } from './types';

type Assignability = boolean | undefined;

export const isTypeConditional = (node: Node): node is ConditionalTypeNode => {
  return isConditionalTypeNode(node);
};

export const tryTypeConditional = (node: Node, context: Context, state: State): EveryType | undefined => {
  if (!isTypeConditional(node)) {
    return undefined;
  }

  const newState = getNewState({ types: state.types });

  const checkType = tryTypes(node.checkType, context, newState);
  const extendsType = tryTypes(node.extendsType, context, newState);

  if (!checkType || !extendsType) {
    return undefined;
  }

  const parameterName = getNakedTypeParameterName(node, context);
  const distributedTypes = getDistributedTypes(checkType);

  if (!parameterName || !distributedTypes) {
    return tryConditionalBranch(node, checkType, extendsType, context, state);
  }

  // Conditional types over a naked type parameter distribute over each union member.
  const branchTypes: EveryType[] = [];

  for (const element of distributedTypes) {
    const elementState = { ...state, types: { ...state.types, [parameterName]: element } };
    const branchType = tryConditionalBranch(node, element, extendsType, context, elementState);

    if (!branchType) {
      return undefined;
    }

    if (branchType.type === TypeName.Union) {
      branchTypes.push(...branchType.elements);
    } else if (branchType.type !== TypeName.Never) {
      branchTypes.push(branchType);
    }
  }

  return createUnion(branchTypes);
};

const tryConditionalBranch = (node: ConditionalTypeNode, checkType: EveryType, extendsType: EveryType, context: Context, state: State) => {
  const assignable = isAssignableType(checkType, extendsType);

  if (assignable === undefined) {
    return undefined;
  }

  return tryTypes(assignable ? node.trueType : node.falseType, context, state);
};

const getDistributedTypes = (type: EveryType): EveryType[] | undefined => {
  if (type.type === TypeName.Union) {
    return type.elements;
  }

  if (type.type === TypeName.Boolean && type.literal === undefined) {
    return [createBoolean('literal', true), createBoolean('literal', false)];
  }

  return undefined;
};

const getNakedTypeParameterName = (node: ConditionalTypeNode, context: Context) => {
  const { checkType } = node;

  if (!isTypeReferenceNode(checkType) || checkType.typeArguments) {
    return undefined;
  }

  const declaration = getNodeTypeDeclaration(checkType.typeName, context.checker);

  if (!declaration || !isTypeParameter(declaration)) {
    return undefined;
  }

  return declaration.name.getText();
};

const everyAssignable = (results: Assignability[]): Assignability => {
  if (results.includes(false)) {
    return false;
  }

  return results.includes(undefined) ? undefined : true;
};

const someAssignable = (results: Assignability[]): Assignability => {
  if (results.includes(true)) {
    return true;
  }

  return results.includes(undefined) ? undefined : false;
};

const isStructuralType = (type: EveryType) => {
  switch (type.type) {
    case TypeName.String:
    case TypeName.Number:
    case TypeName.Boolean:
    case TypeName.Null:
    case TypeName.Undefined:
    case TypeName.Void:
    case TypeName.Object:
    case TypeName.Array:
    case TypeName.Tuple:
      return true;
  }

  return false;
};

// Structural subset of TypeScript assignability; `undefined` means it can't be decided from the reflection.
const isAssignableType = (source: EveryType, target: EveryType): Assignability => {
  if (target.type === TypeName.Any || target.type === TypeName.Unknown) {
    return true;
  }

  if (source.type === TypeName.Any) {
    return undefined;
  }

  if (source.type === TypeName.Never) {
    return true;
  }

  if (source.type === TypeName.Union) {
    return everyAssignable(source.elements.map((element) => isAssignableType(element, target)));
  }

  if (target.type === TypeName.Union) {
    return someAssignable(target.elements.map((element) => isAssignableType(source, element)));
  }

  switch (target.type) {
    case TypeName.Array: {
      if (source.type === TypeName.Array) {
        return isAssignableType(source.element, target.element);
      }

      if (source.type === TypeName.Tuple) {
        return everyAssignable(source.elements.map((element) => isAssignableType(element, target.element)));
      }

      break;
    }

    case TypeName.Tuple: {
      if (source.type === TypeName.Tuple) {
        if (source.elements.length !== target.elements.length) {
          return false;
        }

        return everyAssignable(source.elements.map((element, index) => isAssignableType(element, target.elements[index])));
      }

      break;
    }

    case TypeName.String:
    case TypeName.Number:
    case TypeName.Boolean: {
      if (source.type === target.type) {
        return target.literal === undefined || source.literal === target.literal;
      }

      break;
    }

    case TypeName.Null:
    case TypeName.Undefined:
    case TypeName.Void: {
      if (source.type === target.type || (source.type === TypeName.Undefined && target.type === TypeName.Void)) {
        return true;
      }

      break;
    }

    default:
      return undefined;
  }

  return isStructuralType(source) ? false : undefined;
};
