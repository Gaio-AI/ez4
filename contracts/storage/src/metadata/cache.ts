import type { AllType, ModelProperty, ReflectionTypes, TypeModel, TypeObject } from '@ez4/reflection';
import type { MemberType } from '@ez4/common/library';
import type { Incomplete } from '@ez4/utils';
import type { BucketCacheRule } from './types';

import {
  InvalidServicePropertyError,
  isModelDeclaration,
  getModelMembers,
  getObjectMembers,
  getPropertyString,
  getPropertyTuple,
  getReferenceType,
  hasHeritageType
} from '@ez4/common/library';

import { isModelProperty, isTypeObject, isTypeReference } from '@ez4/reflection';
import { isObjectWith } from '@ez4/utils';

import { IncompleteCacheRuleError, IncorrectCacheRuleTypeError, InvalidCacheRuleTypeError } from '../errors/cache';

export const isBucketCacheRuleDeclaration = (type: TypeModel) => {
  return hasHeritageType(type, 'Bucket.CacheRule');
};

export const getBucketCacheMetadata = (member: ModelProperty, parent: TypeModel, reflection: ReflectionTypes, errorList: Error[]) => {
  const ruleList: BucketCacheRule[] = [];

  for (const type of getPropertyTuple(member) ?? []) {
    const rule = getCacheRule(type, parent, reflection, errorList);

    if (rule) {
      ruleList.push(rule);
    }
  }

  return ruleList;
};

const getCacheRule = (type: AllType, parent: TypeModel, reflection: ReflectionTypes, errorList: Error[]) => {
  if (!isTypeReference(type)) {
    return getTypeCacheRule(type, parent, errorList);
  }

  const declaration = getReferenceType(type, reflection);

  if (declaration) {
    return getTypeCacheRule(declaration, parent, errorList);
  }

  return undefined;
};

const isCompleteCacheRule = (type: Incomplete<BucketCacheRule>): type is BucketCacheRule => {
  return isObjectWith(type, ['path', 'value']);
};

const getTypeCacheRule = (type: AllType, parent: TypeModel, errorList: Error[]) => {
  if (isTypeObject(type)) {
    return getTypeFromMembers(type, parent, getObjectMembers(type), errorList);
  }

  if (!isModelDeclaration(type)) {
    errorList.push(new InvalidCacheRuleTypeError(parent.file));
    return undefined;
  }

  if (!isBucketCacheRuleDeclaration(type)) {
    errorList.push(new IncorrectCacheRuleTypeError(type.name, type.file));
    return undefined;
  }

  return getTypeFromMembers(type, parent, getModelMembers(type), errorList);
};

const getTypeFromMembers = (type: TypeObject | TypeModel, parent: TypeModel, members: MemberType[], errorList: Error[]) => {
  const rule: Incomplete<BucketCacheRule> = {};
  const properties = new Set(['path', 'value']);

  for (const member of members) {
    if (!isModelProperty(member) || member.inherited) {
      continue;
    }

    switch (member.name) {
      default: {
        errorList.push(new InvalidServicePropertyError(parent.name, member.name, type.file));
        break;
      }

      case 'path':
      case 'value': {
        if ((rule[member.name] = getPropertyString(member))) {
          properties.delete(member.name);
        }
        break;
      }
    }
  }

  if (!isCompleteCacheRule(rule)) {
    errorList.push(new IncompleteCacheRuleError([...properties], type.file));
    return undefined;
  }

  return rule;
};
