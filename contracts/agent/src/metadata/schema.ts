import type { AllType, ModelProperty, ReflectionTypes, TypeClass } from '@ez4/reflection';
import { isTypeObject, isTypeReference } from '@ez4/reflection';
import { getReferenceType, isModelDeclaration } from '@ez4/common/library';
import { getObjectSchema } from '@ez4/schema/library';
import { isObjectSchema } from '@ez4/schema';
import type { AgentService } from './types';
import { IncompleteServiceError } from '../errors/service';

export const parseAgentSchema = (
  members: Record<string, ModelProperty>,
  declaration: TypeClass,
  service: AgentService,
  reflection: ReflectionTypes,
  errorList: Error[]
) => {
  const missing: string[] = [];

  const inputMember = members.input;
  if (!inputMember) {
    missing.push('input');
  } else {
    service.inputSchema = resolveSchema(inputMember.value, declaration, reflection);
    if (!service.inputSchema) {
      missing.push('input');
    }
  }

  const outputMember = members.output;
  if (!outputMember) {
    missing.push('output');
  } else {
    service.outputSchema = resolveSchema(outputMember.value, declaration, reflection);
    if (!service.outputSchema) {
      missing.push('output');
    }
  }

  if (missing.length > 0) {
    errorList.push(new IncompleteServiceError(missing, declaration.file));
  }
};

const resolveSchema = (type: AllType, _declaration: TypeClass, reflection: ReflectionTypes) => {
  if (isTypeReference(type)) {
    const target = getReferenceType(type, reflection);
    if (target && isModelDeclaration(target)) {
      const schema = getObjectSchema(target, reflection);
      if (schema && isObjectSchema(schema)) {
        return schema;
      }
    }
  }
  if (isTypeObject(type)) {
    const schema = getObjectSchema(type, reflection);
    if (schema && isObjectSchema(schema)) {
      return schema;
    }
  }
  return undefined;
};
