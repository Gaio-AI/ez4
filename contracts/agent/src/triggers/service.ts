import type { TypeClass } from '@ez4/reflection';
import { isClassDeclaration, hasHeritageType } from '@ez4/common/library';

export const getLinkedService = (declaration: TypeClass): string | null => {
  return isClassDeclaration(declaration) && hasHeritageType(declaration, 'Agent.Service') ? declaration.name : null;
};
