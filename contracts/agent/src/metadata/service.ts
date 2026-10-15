import type { AllType, ModelProperty, ReflectionTypes, TypeClass, TypeObject } from '@ez4/reflection';
import { isModelProperty, isTypeTuple } from '@ez4/reflection';
import {
  DuplicateServiceError,
  isSameSourceFile,
  hasHeritageType,
  isClassDeclaration,
  getDeclarationDescription,
  getModelMembers,
  getPropertyString,
  getPropertyStringIn,
  getPropertyStringList,
  getPropertyObject,
  getLinkedVariablesObject,
  getLinkedServicesObject,
  getServiceTags
} from '@ez4/common/library';
import type { Agent } from '../services/contract';
import type { AgentService } from './types';
import { createAgentService } from './types';
import { parseAgentSchema } from './schema';
import { parseAgentHooks } from './hooks';
import { validateResources } from './resources';
import { validatePermissions } from './permissions';
import { IncompleteServiceError } from '../errors/service';

const objectMembers = (object: TypeObject): Record<string, ModelProperty> | undefined => {
  if (!Array.isArray(object.members) || !object.members.every(isModelProperty)) return undefined;
  return Object.fromEntries(object.members.map((member) => [member.name, member]));
};

const stringList = (member: ModelProperty): string[] | undefined => {
  if (!isTypeTuple(member.value)) return undefined;
  if (member.value.elements.length === 0) return [];
  const values = getPropertyStringList(member);
  return values?.length === member.value.elements.length ? values : undefined;
};

const stringMap = (member: ModelProperty): Record<string, string> | undefined => {
  const object = getPropertyObject(member);
  const members = object && objectMembers(object);
  if (!members) return undefined;
  const values: Record<string, string> = {};
  for (const [key, value] of Object.entries(members)) {
    const string = getPropertyString(value);
    if (string === undefined) return undefined;
    values[key] = string;
  }
  return values;
};

const parseOptionalMembers = (
  members: Record<string, ModelProperty>,
  declaration: TypeClass,
  service: AgentService,
  errorList: Error[]
) => {
  const invalid = (name: string) => errorList.push(new IncompleteServiceError([`${declaration.name}.${name}`], declaration.file));

  if (members.tools) {
    const object = getPropertyObject(members.tools);
    const tools = object && objectMembers(object);
    const mode = tools?.mode && getPropertyStringIn(tools.mode, ['edit', 'readonly']);
    const allowed = tools?.allowed && stringList(tools.allowed);
    const disallowed = tools?.disallowed && stringList(tools.disallowed);
    if (!tools || !mode || (tools.allowed && !allowed) || (tools.disallowed && !disallowed)) {
      invalid('tools');
    } else {
      service.tools = { mode, ...(allowed && { allowed }), ...(disallowed && { disallowed }) };
    }
  }

  if (members.image) {
    const object = getPropertyObject(members.image);
    const image = object && objectMembers(object);
    const base = image?.base && getPropertyString(image.base);
    const aptPackages = image?.aptPackages && stringList(image.aptPackages);
    const npmPackages = image?.npmPackages && stringList(image.npmPackages);
    if (!image || (image.base && base === undefined) || (image.aptPackages && !aptPackages) || (image.npmPackages && !npmPackages)) {
      invalid('image');
    } else {
      service.image = { ...(base !== undefined && { base }), ...(aptPackages && { aptPackages }), ...(npmPackages && { npmPackages }) };
    }
  }

  if (members.egress) {
    const egress = stringList(members.egress);
    if (!egress) invalid('egress');
    else service.egress = egress;
  }

  if (members.secrets) {
    const secrets = stringMap(members.secrets);
    if (!secrets) invalid('secrets');
    else service.secrets = secrets;
  }

  if (members.mcpServers) {
    const object = getPropertyObject(members.mcpServers);
    const servers = object && objectMembers(object);
    const parsed: Record<string, Agent.McpServer> = {};
    let valid = !!servers;
    for (const [name, member] of Object.entries(servers ?? {})) {
      const serverObject = getPropertyObject(member);
      const server = serverObject && objectMembers(serverObject);
      const command = server?.command && getPropertyString(server.command);
      const url = server?.url && getPropertyString(server.url);
      const args = server?.args && stringList(server.args);
      const env = server?.env && stringMap(server.env);
      const headers = server?.headers && stringMap(server.headers);
      if (
        !server ||
        (command === undefined) === (url === undefined) ||
        (server.args && !args) ||
        (server.env && !env) ||
        (server.headers && !headers) ||
        (command !== undefined && server.headers) ||
        (url !== undefined && (server.args || server.env))
      ) {
        valid = false;
        break;
      }
      parsed[name] =
        command !== undefined ? { command, ...(args && { args }), ...(env && { env }) } : { url: url!, ...(headers && { headers }) };
    }
    if (!valid) invalid('mcpServers');
    else service.mcpServers = parsed;
  }
};

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
      if (
        isModelProperty(member) &&
        (!member.inherited || !['tools', 'mcpServers', 'image', 'egress', 'secrets', 'permissions'].includes(member.name))
      ) {
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
    parseOptionalMembers(members, declaration, service, errorList);

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
