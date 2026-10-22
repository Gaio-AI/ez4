import type { AllType, ReflectionTypes, TypeClass } from '@ez4/reflection';
import type { Incomplete } from '@ez4/utils';
import type { EncryptionService } from './types';

import {
  DuplicateServiceError,
  isSameSourceFile,
  InvalidServicePropertyError,
  isExternalDeclaration,
  isClassDeclaration,
  getLinkedServicesObject,
  getLinkedVariablesObject,
  getDeclarationDescription,
  getModelMembers,
  hasHeritageType
} from '@ez4/common/library';

import { isModelProperty } from '@ez4/reflection';
import { isObjectWith } from '@ez4/utils';

import { createEncryptionService } from './types';

export const isEncryptionServiceDeclaration = (type: AllType): type is TypeClass => {
  return isClassDeclaration(type) && hasHeritageType(type, 'Encryption.Service');
};

export const getEncryptionServicesMetadata = (reflection: ReflectionTypes) => {
  const allServices: Record<string, EncryptionService> = {};
  const errorList: Error[] = [];

  for (const identity in reflection) {
    const declaration = reflection[identity];

    if (!isEncryptionServiceDeclaration(declaration) || isExternalDeclaration(declaration)) {
      continue;
    }

    const { file: fileName } = declaration;

    const service = createEncryptionService(declaration.name, fileName, getDeclarationDescription(declaration));

    for (const member of getModelMembers(declaration)) {
      if (!isModelProperty(member)) {
        continue;
      }

      switch (member.name) {
        default: {
          errorList.push(new InvalidServicePropertyError(service.name, member.name, fileName));
          break;
        }

        case 'client':
          break;

        case 'variables': {
          service.variables = getLinkedVariablesObject(member, errorList);
          break;
        }

        case 'services': {
          service.services = getLinkedServicesObject(member, reflection, errorList);
          break;
        }
      }
    }

    if (!isCompleteService(service)) {
      continue;
    }

    const existingService = allServices[declaration.name];

    if (existingService) {
      if (!isSameSourceFile(existingService.file, fileName)) {
        errorList.push(new DuplicateServiceError(declaration.name, fileName));
      }
      continue;
    }

    allServices[declaration.name] = service;
  }

  return {
    services: allServices,
    errors: errorList
  };
};

const isCompleteService = (type: Incomplete<EncryptionService>): type is EncryptionService => {
  return isObjectWith(type, ['variables', 'services']);
};
