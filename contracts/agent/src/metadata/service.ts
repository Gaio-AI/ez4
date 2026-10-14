import type { AllType, ReflectionTypes, TypeClass } from '@ez4/reflection';
import { isModelProperty } from '@ez4/reflection';
import {
  DuplicateServiceError,
  isSameSourceFile,
  hasHeritageType,
  isClassDeclaration,
  getDeclarationDescription,
  getModelMembers,
  getPropertyString,
  getLinkedVariablesObject,
  getLinkedServicesObject,
  getServiceTags
} from '@ez4/common/library';
import type { ModelProperty } from '@ez4/reflection';
import type { Agent } from '../services/contract';
import type { AgentService } from './types';
import { createAgentService } from './types';
import { parseAgentSchema } from './schema';
import { parseAgentHooks } from './hooks';
import { validateResources } from './resources';
import { validatePermissions } from './permissions';
import { IncompleteServiceError } from '../errors/service';

export const isAgentServiceDeclaration = (type: AllType): type is TypeClass => {
  return isClassDeclaration(type) && hasHeritageType(type, 'Agent.Service');
};

export const getAgentServicesMetadata = (reflection: ReflectionTypes) => {
  const errorList: Error[] = [];
  const allServices: Record<string, AgentService> = {};

  for (const identity in reflection) {
    const declaration = reflection[identity];
    if (!isAgentServiceDeclaration(declaration)) {
      continue;
    }

    const { file: fileName } = declaration;
    const existing = allServices[declaration.name];
    if (existing) {
      if (!isSameSourceFile(existing.file, fileName)) {
        errorList.push(new DuplicateServiceError(declaration.name, fileName));
      }
      continue;
    }

    const service = createAgentService(declaration.name, fileName, getDeclarationDescription(declaration) ?? undefined);

    const members: Record<string, ModelProperty> = {};
    for (const member of getModelMembers(declaration, true)) {
      if (isModelProperty(member)) {
        members[member.name] = member;
      }
    }

    const provider = members.provider ? getPropertyString(members.provider) : undefined;
    const model = members.model ? getPropertyString(members.model) : undefined;
    const instructions = members.instructions ? getPropertyString(members.instructions) : undefined;

    const missing: string[] = [];
    if (!provider) missing.push('provider');
    if (!model) missing.push('model');
    if (!instructions) missing.push('instructions');

    if (missing.length > 0) {
      errorList.push(new IncompleteServiceError(missing, fileName));
      continue;
    }

    service.provider = provider as Agent.ProviderName;
    service.model = model;
    service.instructions = instructions;

    parseAgentSchema(members, declaration, service, reflection, errorList);
    parseAgentHooks(members, declaration, service, reflection, errorList);
    validateResources(members, declaration, service, errorList);
    validatePermissions(members, declaration, service, errorList);

    if (members.variables) {
      service.variables = getLinkedVariablesObject(members.variables, errorList) ?? {};
    }
    if (members.services) {
      service.services = getLinkedServicesObject(members.services, reflection, errorList) ?? {};
    }
    if (members.tags) {
      service.tags = getServiceTags(members.tags);
    }

    allServices[declaration.name] = service;
  }

  return {
    services: allServices,
    errors: errorList
  };
};
