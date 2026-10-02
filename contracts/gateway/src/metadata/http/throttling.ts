import type { AllType, ReflectionTypes, TypeModel, TypeObject } from '@ez4/reflection';
import type { MemberType } from '@ez4/common/library';
import type { Incomplete } from '@ez4/utils';
import type { HttpThrottling } from './types';

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
  IncompleteThrottlingError,
  IncorrectThrottlingTypeError,
  InvalidThrottlingLimitError,
  InvalidThrottlingTypeError
} from '../../errors/http/throttling';

import { getFullTypeName } from '../utils/name';
import { HttpNamespaceType } from './types';

export const isHttpThrottlingDeclaration = (type: TypeModel) => {
  return hasHeritageType(type, getFullTypeName(HttpNamespaceType, 'Throttling'));
};

export const getHttpThrottlingMetadata = (type: AllType, parent: TypeModel, reflection: ReflectionTypes, errorList: Error[]) => {
  if (!isTypeReference(type)) {
    return getThrottlingType(type, parent, errorList);
  }

  const declaration = getReferenceType(type, reflection);

  if (declaration) {
    return getThrottlingType(declaration, parent, errorList);
  }

  return undefined;
};

const isCompleteThrottling = (type: Incomplete<HttpThrottling>): type is HttpThrottling => {
  return isObjectWith(type, ['rateLimit', 'burstLimit']);
};

const getThrottlingType = (type: AllType, parent: TypeModel, errorList: Error[]) => {
  if (isTypeObject(type)) {
    return getTypeFromMembers(type, parent, getObjectMembers(type), errorList);
  }

  if (!isModelDeclaration(type)) {
    errorList.push(new InvalidThrottlingTypeError(parent.file));
    return undefined;
  }

  if (!isHttpThrottlingDeclaration(type)) {
    errorList.push(new IncorrectThrottlingTypeError(type.name, type.file));
    return undefined;
  }

  return getTypeFromMembers(type, parent, getModelMembers(type), errorList);
};

const getTypeFromMembers = (type: TypeObject | TypeModel, parent: TypeModel, members: MemberType[], errorList: Error[]) => {
  const throttling: Incomplete<HttpThrottling> = {};
  const properties = new Set(['rateLimit', 'burstLimit']);

  for (const member of members) {
    if (!isModelProperty(member) || member.inherited) {
      continue;
    }

    switch (member.name) {
      default: {
        errorList.push(new InvalidServicePropertyError(parent.name, member.name, type.file));
        break;
      }

      case 'rateLimit':
      case 'burstLimit': {
        const value = getPropertyNumber(member);

        if (!isAnyNumber(value)) {
          break;
        }

        properties.delete(member.name);

        // A zero limit makes the gateway reject every request.
        if (!Number.isInteger(value) || value <= 0) {
          errorList.push(new InvalidThrottlingLimitError(member.name, value, type.file));
        } else {
          throttling[member.name] = value;
        }

        break;
      }
    }
  }

  if (!isCompleteThrottling(throttling)) {
    if (properties.size > 0) {
      errorList.push(new IncompleteThrottlingError([...properties], type.file));
    }

    return undefined;
  }

  return throttling;
};
