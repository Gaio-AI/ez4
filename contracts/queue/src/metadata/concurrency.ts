import type { AllType, ReflectionTypes, TypeModel, TypeObject } from '@ez4/reflection';
import type { MemberType } from '@ez4/common/library';
import type { Incomplete } from '@ez4/utils';
import type { QueueKeyConcurrency } from './types';

import {
  InvalidServicePropertyError,
  isModelDeclaration,
  getModelMembers,
  getObjectMembers,
  getPropertyNumber,
  getReferenceType,
  hasHeritageType
} from '@ez4/common/library';

import { isModelProperty, isTypeObject, isTypeReference } from '@ez4/reflection';
import { isAnyNumber, isObjectWith } from '@ez4/utils';

import {
  IncompleteKeyConcurrencyError,
  IncorrectKeyConcurrencyTypeError,
  InvalidKeyConcurrencyMaxError,
  InvalidKeyConcurrencyTypeError
} from '../errors/concurrency';

import { getKeyFieldsProperty } from './utils/key';

export const isQueueKeyConcurrencyDeclaration = (type: TypeModel) => {
  return hasHeritageType(type, 'Queue.KeyConcurrency');
};

export const getQueueKeyConcurrencyMetadata = (type: AllType, parent: TypeModel, reflection: ReflectionTypes, errorList: Error[]) => {
  if (!isTypeReference(type)) {
    return getKeyConcurrencyType(type, parent, errorList);
  }

  const declaration = getReferenceType(type, reflection);

  if (declaration) {
    return getKeyConcurrencyType(declaration, parent, errorList);
  }

  return undefined;
};

const isCompleteKeyConcurrency = (type: Incomplete<QueueKeyConcurrency>): type is QueueKeyConcurrency => {
  return isObjectWith(type, ['key', 'max']);
};

const getKeyConcurrencyType = (type: AllType, parent: TypeModel, errorList: Error[]) => {
  if (isTypeObject(type)) {
    return getTypeFromMembers(type, parent, getObjectMembers(type), errorList);
  }

  if (!isModelDeclaration(type)) {
    errorList.push(new InvalidKeyConcurrencyTypeError(parent.file));
    return undefined;
  }

  if (!isQueueKeyConcurrencyDeclaration(type)) {
    errorList.push(new IncorrectKeyConcurrencyTypeError(type.name, type.file));
    return undefined;
  }

  return getTypeFromMembers(type, parent, getModelMembers(type), errorList);
};

const getTypeFromMembers = (type: TypeObject | TypeModel, parent: TypeModel, members: MemberType[], errorList: Error[]) => {
  const keyConcurrency: Incomplete<QueueKeyConcurrency> = {};
  const properties = new Set(['key', 'max']);

  for (const member of members) {
    if (!isModelProperty(member) || member.inherited) {
      continue;
    }

    switch (member.name) {
      default: {
        errorList.push(new InvalidServicePropertyError(parent.name, member.name, type.file));
        break;
      }

      case 'key': {
        const fieldNames = getKeyFieldsProperty(member);

        if (fieldNames?.length) {
          keyConcurrency.key = fieldNames;
          properties.delete(member.name);
        }
        break;
      }

      case 'max': {
        const max = getPropertyNumber(member);

        if (!isAnyNumber(max)) {
          break;
        }

        if (Number.isInteger(max) && max > 0) {
          keyConcurrency.max = max;
        } else {
          errorList.push(new InvalidKeyConcurrencyMaxError(max, type.file));
        }

        properties.delete(member.name);
        break;
      }
    }
  }

  if (!isCompleteKeyConcurrency(keyConcurrency)) {
    if (properties.size) {
      errorList.push(new IncompleteKeyConcurrencyError([...properties], type.file));
    }

    return undefined;
  }

  return keyConcurrency;
};
