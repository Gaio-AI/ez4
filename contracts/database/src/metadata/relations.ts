import type { AllType, ModelProperty, ReflectionTypes, TypeModel, TypeObject } from '@ez4/reflection';
import type { MemberType } from '@ez4/common/library';
import type { RelationDeleteAction, TableRelation } from './types';

import {
  isModelDeclaration,
  getModelMembers,
  getObjectMembers,
  getPropertyBoolean,
  getPropertyObject,
  getPropertyString,
  getPropertyStringIn,
  getReferenceType,
  hasHeritageType
} from '@ez4/common/library';

import { isModelProperty, isTypeObject, isTypeReference } from '@ez4/reflection';

import {
  IncorrectRelationsTypeError,
  InvalidRelationOptionError,
  InvalidRelationsTypeError,
  InvalidRelationTargetError
} from '../errors/relations';

type TypeParent = TypeModel | TypeObject;

export const isTableRelationsDeclaration = (type: TypeModel) => {
  return hasHeritageType(type, 'Database.Relations');
};

export const getTableRelationsMetadata = (type: AllType, parent: TypeParent, reflection: ReflectionTypes, errorList: Error[]) => {
  if (!isTypeReference(type)) {
    return getTypeRelations(type, parent, errorList);
  }

  const declaration = getReferenceType(type, reflection);

  if (declaration) {
    return getTypeRelations(declaration, parent, errorList);
  }

  return undefined;
};

const getTypeRelations = (type: AllType, parent: TypeParent, errorList: Error[]) => {
  if (isTypeObject(type)) {
    return getTypeFromMembers(type, getObjectMembers(type), errorList);
  }

  if (!isModelDeclaration(type)) {
    errorList.push(new InvalidRelationsTypeError(parent.file));
    return undefined;
  }

  if (!isTableRelationsDeclaration(type)) {
    errorList.push(new IncorrectRelationsTypeError(type.name, type.file));
    return undefined;
  }

  return getTypeFromMembers(type, getModelMembers(type), errorList);
};

const getTypeFromMembers = (type: TypeObject | TypeModel, members: MemberType[], errorList: Error[]) => {
  const relations: TableRelation[] = [];

  for (const member of members) {
    if (!isModelProperty(member) || member.inherited) {
      continue;
    }

    const relationTarget = member.name;
    const relationOptions = getRelationOptions(member, type, errorList);

    if (!relationOptions) {
      return undefined;
    }

    const { source, onDelete, foreignKey } = relationOptions;

    const [targetColumn, targetAlias] = relationTarget.split('@', 2);
    const [sourceTable, sourceColumn] = source.split(':', 2);

    relations.push({
      sourceTable,
      sourceColumn,
      targetColumn,
      targetAlias,
      ...(onDelete && { onDelete }),
      ...(foreignKey !== undefined && { foreignKey })
    });
  }

  return relations;
};

const RELATION_DELETE_ACTIONS: RelationDeleteAction[] = ['cascade', 'set null', 'restrict', 'no action'];

/**
 * A relation is either its source (`'table:column'`) or an object with the source and its options.
 */
const getRelationOptions = (member: ModelProperty, type: TypeObject | TypeModel, errorList: Error[]) => {
  const relationTarget = member.name;
  const relationSource = getPropertyString(member);

  if (relationSource) {
    return {
      source: relationSource
    };
  }

  const relationObject = getPropertyObject(member);

  if (!relationObject) {
    errorList.push(new InvalidRelationTargetError(relationTarget, type.file));
    return undefined;
  }

  const options: Partial<Pick<TableRelation, 'onDelete' | 'foreignKey'>> & { source?: string } = {};

  for (const option of getObjectMembers(relationObject)) {
    if (!isModelProperty(option)) {
      continue;
    }

    switch (option.name) {
      case 'source': {
        options.source = getPropertyString(option);
        break;
      }

      case 'onDelete': {
        if (!(options.onDelete = getPropertyStringIn(option, RELATION_DELETE_ACTIONS))) {
          errorList.push(new InvalidRelationOptionError(relationTarget, option.name, type.file));
          return undefined;
        }

        break;
      }

      case 'foreignKey': {
        if ((options.foreignKey = getPropertyBoolean(option)) === undefined) {
          errorList.push(new InvalidRelationOptionError(relationTarget, option.name, type.file));
          return undefined;
        }

        break;
      }

      default: {
        errorList.push(new InvalidRelationOptionError(relationTarget, option.name, type.file));
        return undefined;
      }
    }
  }

  const { source, ...relationOptions } = options;

  if (!source) {
    errorList.push(new InvalidRelationTargetError(relationTarget, type.file));
    return undefined;
  }

  return {
    ...relationOptions,
    source
  };
};
