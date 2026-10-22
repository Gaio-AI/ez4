import type { AllType, ReflectionTypes, TypeClass } from '@ez4/reflection';
import type { Incomplete } from '@ez4/utils';
import type { EncryptionImport } from './types';

import {
  DuplicateServiceError,
  isSameSourceFile,
  InvalidServicePropertyError,
  isExternalDeclaration,
  isClassDeclaration,
  getDeclarationDescription,
  getModelMembers,
  getPropertyString,
  getReferenceName,
  hasHeritageType
} from '@ez4/common/library';

import { isModelProperty, isTypeReference } from '@ez4/reflection';
import { isObjectWith } from '@ez4/utils';

import { IncompleteServiceError } from '../errors/service';
import { createEncryptionImport } from './types';

export const isEncryptionImportDeclaration = (type: AllType): type is TypeClass => {
  return isClassDeclaration(type) && hasHeritageType(type, 'Encryption.Import');
};

export const getEncryptionImportsMetadata = (reflection: ReflectionTypes) => {
  const allImports: Record<string, EncryptionImport> = {};
  const errorList: Error[] = [];

  for (const identity in reflection) {
    const declaration = reflection[identity];

    if (!isEncryptionImportDeclaration(declaration) || isExternalDeclaration(declaration)) {
      continue;
    }

    const { file: fileName } = declaration;

    const service = createEncryptionImport(declaration.name, fileName, getDeclarationDescription(declaration));
    const properties = new Set(['project', 'reference']);

    for (const member of getModelMembers(declaration, true)) {
      if (!isModelProperty(member)) {
        continue;
      }

      switch (member.name) {
        default: {
          if (!member.inherited) {
            errorList.push(new InvalidServicePropertyError(service.name, member.name, fileName));
          }
          break;
        }

        case 'client':
          break;

        case 'reference': {
          if (member.inherited && isTypeReference(member.value)) {
            service.reference = getReferenceName(member.value);
            properties.delete(member.name);
          }
          break;
        }

        case 'project': {
          if (!member.inherited && (service.project = getPropertyString(member))) {
            properties.delete(member.name);
          }
          break;
        }
      }
    }

    if (!isCompleteImport(service)) {
      errorList.push(new IncompleteServiceError([...properties], fileName));
      continue;
    }

    const existingImport = allImports[declaration.name];

    if (existingImport) {
      if (!isSameSourceFile(existingImport.file, fileName)) {
        errorList.push(new DuplicateServiceError(declaration.name, fileName));
      }
      continue;
    }

    allImports[declaration.name] = service;
  }

  return {
    services: allImports,
    errors: errorList
  };
};

const isCompleteImport = (type: Incomplete<EncryptionImport>): type is EncryptionImport => {
  return isObjectWith(type, ['project', 'reference', 'variables', 'services']);
};
