import type { TypeClass } from '@ez4/reflection';

import { isEncryptionServiceDeclaration } from '../metadata/service';
import { isEncryptionImportDeclaration } from '../metadata/import';

export const getLinkedService = (declaration: TypeClass): string | null => {
  return isEncryptionServiceDeclaration(declaration) ? declaration.name : null;
};

export const getLinkedImport = (declaration: TypeClass): string | null => {
  return isEncryptionImportDeclaration(declaration) ? declaration.name : null;
};
