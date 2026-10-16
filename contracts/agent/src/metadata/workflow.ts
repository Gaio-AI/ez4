import type { AllType, ModelProperty, ReflectionTypes } from '@ez4/reflection';
import { isModelProperty, isTypeCallback, isTypeFunction, isTypeObject, isTypeReference } from '@ez4/reflection';
import { isObjectSchema } from '@ez4/schema';
import { getObjectSchema } from '@ez4/schema/library';
import {
  DuplicateServiceError,
  getDeclarationDescription,
  getFunctionSignature,
  getLinkedServicesObject,
  getLinkedVariablesObject,
  getModelMembers,
  getPropertyNumber,
  getPropertyObject,
  getReferenceType,
  getServiceTags,
  hasHeritageType,
  isClassDeclaration,
  isModelDeclaration,
  isSameSourceFile
} from '@ez4/common/library';
import { IncompleteServiceError, InvalidMaxStepsError, UnknownWorkflowAgentError } from '../errors/service';
import { isAgentServiceDeclaration } from './service';
import { createAgentWorkflowService, type AgentWorkflowService } from './types';

const resolveType = (type: AllType, reflection: ReflectionTypes): AllType => {
  return isTypeReference(type) ? getReferenceType(type, reflection) : type;
};

export const getAgentWorkflowServicesMetadata = (reflection: ReflectionTypes) => {
  const errors: Error[] = [];
  const services: Record<string, AgentWorkflowService> = {};

  for (const identity in reflection) {
    const declaration = reflection[identity];
    if (!isClassDeclaration(declaration) || !hasHeritageType(declaration, 'Agent.Workflow')) continue;

    const existing = services[declaration.name];
    if (existing) {
      if (!isSameSourceFile(existing.file, declaration.file)) errors.push(new DuplicateServiceError(declaration.name, declaration.file));
      continue;
    }

    const service = createAgentWorkflowService(declaration.name, declaration.file, getDeclarationDescription(declaration) ?? undefined);
    const members: Record<string, ModelProperty> = {};
    for (const member of getModelMembers(declaration, true)) {
      if (isModelProperty(member) && (!member.inherited || !['maxSteps'].includes(member.name))) members[member.name] = member;
    }

    const missing: string[] = [];
    if (members.input) {
      const target = members.input.value;
      if (isTypeReference(target)) {
        const ref = getReferenceType(target, reflection);
        if (ref && isModelDeclaration(ref)) {
          const schema = getObjectSchema(ref, reflection);
          if (schema && isObjectSchema(schema)) service.inputSchema = schema;
        }
      } else if (isTypeObject(target)) {
        const schema = getObjectSchema(target, reflection);
        if (schema && isObjectSchema(schema)) service.inputSchema = schema;
      }
    }
    if (!service.inputSchema) missing.push('input');

    const agents = members.agents && getPropertyObject(members.agents);
    if (!agents || !Array.isArray(agents.members) || !agents.members.every(isModelProperty)) {
      missing.push('agents');
    } else {
      for (const agent of agents.members) {
        const target = resolveType(agent.value, reflection);
        if (!isClassDeclaration(target) || !isAgentServiceDeclaration(target) || !Object.values(reflection).includes(target)) {
          errors.push(new UnknownWorkflowAgentError(declaration.name, agent.name));
        } else {
          service.agents[agent.name] = target.name;
        }
      }
    }

    const handler = members.handler && resolveType(members.handler.value, reflection);
    if (handler && (isTypeFunction(handler) || isTypeCallback(handler))) {
      const signature = getFunctionSignature(handler);
      if (signature) service.handler = signature;
    }
    if (!service.handler) missing.push('handler');
    if (missing.length) errors.push(new IncompleteServiceError(missing, declaration.file));

    if (members.maxSteps) {
      const maxSteps = getPropertyNumber(members.maxSteps);
      if (maxSteps === undefined || !Number.isInteger(maxSteps) || maxSteps < 1 || maxSteps > 100) {
        errors.push(new InvalidMaxStepsError(declaration.name, maxSteps));
      } else {
        service.maxSteps = maxSteps;
      }
    }
    if (members.variables) service.variables = getLinkedVariablesObject(members.variables, errors) ?? {};
    if (members.services) service.services = getLinkedServicesObject(members.services, reflection, errors) ?? {};
    if (members.tags) service.tags = getServiceTags(members.tags);
    services[declaration.name] = service;
  }

  return { services, errors };
};
