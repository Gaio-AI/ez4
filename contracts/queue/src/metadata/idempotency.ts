import type { AllType, ReflectionTypes, TypeModel, TypeObject } from '@ez4/reflection';
import type { MemberType } from '@ez4/common/library';
import type { Incomplete } from '@ez4/utils';
import type { QueueIdempotency } from './types';

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

import { getKeyFieldsProperty } from './utils/key';

import {
  IncompleteIdempotencyError,
  IncorrectIdempotencyTypeError,
  InvalidIdempotencyTtlError,
  InvalidIdempotencyTypeError
} from '../errors/idempotency';

export const isQueueIdempotencyDeclaration = (type: TypeModel) => {
  return hasHeritageType(type, 'Queue.Idempotency');
};

export const getQueueIdempotencyMetadata = (type: AllType, parent: TypeModel, reflection: ReflectionTypes, errorList: Error[]) => {
  if (!isTypeReference(type)) {
    return getIdempotencyType(type, parent, errorList);
  }

  const declaration = getReferenceType(type, reflection);

  if (declaration) {
    return getIdempotencyType(declaration, parent, errorList);
  }

  return undefined;
};

const isCompleteIdempotency = (type: Incomplete<QueueIdempotency>): type is QueueIdempotency => {
  return isObjectWith(type, ['key', 'ttl']);
};

const getIdempotencyType = (type: AllType, parent: TypeModel, errorList: Error[]) => {
  if (isTypeObject(type)) {
    return getTypeFromMembers(type, parent, getObjectMembers(type), errorList);
  }

  if (!isModelDeclaration(type)) {
    errorList.push(new InvalidIdempotencyTypeError(parent.file));
    return undefined;
  }

  if (!isQueueIdempotencyDeclaration(type)) {
    errorList.push(new IncorrectIdempotencyTypeError(type.name, type.file));
    return undefined;
  }

  return getTypeFromMembers(type, parent, getModelMembers(type), errorList);
};

const getTypeFromMembers = (type: TypeObject | TypeModel, parent: TypeModel, members: MemberType[], errorList: Error[]) => {
  const idempotency: Incomplete<QueueIdempotency> = {};
  const properties = new Set(['key', 'ttl']);

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
          idempotency.key = fieldNames;
          properties.delete(member.name);
        }
        break;
      }

      case 'ttl': {
        const ttl = getPropertyNumber(member);

        if (!isAnyNumber(ttl)) {
          break;
        }

        if (Number.isInteger(ttl) && ttl > 0) {
          idempotency.ttl = ttl;
        } else {
          errorList.push(new InvalidIdempotencyTtlError(ttl, type.file));
        }

        properties.delete(member.name);
        break;
      }
    }
  }

  if (!isCompleteIdempotency(idempotency)) {
    if (properties.size) {
      errorList.push(new IncompleteIdempotencyError([...properties], type.file));
    }

    return undefined;
  }

  return idempotency;
};
