import type { ModelProperty, TypeClass } from '@ez4/reflection';
import type { Agent } from '../services/contract';
import type { AgentService } from './types';

import { isModelProperty, isTypeObject, isTypeTuple } from '@ez4/reflection';
import { getPropertyString, getPropertyStringIn, getPropertyStringList } from '@ez4/common/library';
import { AgentPermission } from '../services/permissions';
import { InvalidGrantResourceError, UnknownPermissionError } from '../errors/permissions';
import { IncompleteServiceError } from '../errors/service';

const AGENT_PERMISSIONS = [
  AgentPermission.LogsRead,
  AgentPermission.LambdaRead,
  AgentPermission.EcsRead,
  AgentPermission.CloudFormationRead,
  AgentPermission.CodeArtifactRead
];

const CODEARTIFACT_REPOSITORY = /^[a-z][a-z0-9-]{1,49}\/[A-Za-z0-9][A-Za-z0-9._-]{1,99}$/;

export const validatePermissions = (
  members: Record<string, ModelProperty>,
  declaration: TypeClass,
  service: AgentService,
  errorList: Error[]
) => {
  const member = members.permissions;
  if (!member || !isTypeObject(member.value) || !Array.isArray(member.value.members)) {
    return;
  }

  const permissions = Object.fromEntries(member.value.members.filter(isModelProperty).map((field) => [field.name, field]));

  if (permissions.grants) {
    const grants = readGrants(permissions.grants, declaration, errorList);
    if (grants) {
      service.permissions = { ...service.permissions, grants };
    } else {
      errorList.push(new IncompleteServiceError([`${declaration.name}.permissions.grants`], declaration.file));
    }
  }

  if (permissions.statements) {
    const statements = readStatements(permissions.statements);
    if (statements) {
      service.permissions = { ...service.permissions, statements };
    } else {
      errorList.push(new IncompleteServiceError([`${declaration.name}.permissions.statements`], declaration.file));
    }
  }
};

const readGrants = (member: ModelProperty, declaration: TypeClass, errorList: Error[]): Agent.Grant[] | undefined => {
  const entries = getObjectEntries(member);
  if (!entries) {
    return undefined;
  }

  const grants: Agent.Grant[] = [];

  for (const fields of entries) {
    const resources = getLiteralStrings(fields.resources);
    if (!fields.permission || !resources) {
      return undefined;
    }

    const permission = getPropertyStringIn(fields.permission, AGENT_PERMISSIONS);
    if (!permission) {
      errorList.push(new UnknownPermissionError(getPropertyString(fields.permission) ?? 'unknown', declaration.file));
      continue;
    }

    if (permission === AgentPermission.CodeArtifactRead) {
      const invalid = resources.find((resource) => !CODEARTIFACT_REPOSITORY.test(resource));
      if (invalid !== undefined) {
        errorList.push(new InvalidGrantResourceError(permission, invalid, declaration.file));
        continue;
      }
    }

    grants.push({ permission, resources });
  }

  return grants;
};

const readStatements = (member: ModelProperty): Agent.Statement[] | undefined => {
  const entries = getObjectEntries(member);
  if (!entries) {
    return undefined;
  }

  const statements: Agent.Statement[] = [];

  for (const fields of entries) {
    const actions = getLiteralStrings(fields.actions);
    const resources = getLiteralStrings(fields.resources);
    if (!actions || !resources) {
      return undefined;
    }

    statements.push({ actions, resources });
  }

  return statements;
};

/** Fields of each object in a tuple member, or undefined when any element is not an object. */
const getObjectEntries = (member: ModelProperty) => {
  if (!isTypeTuple(member.value)) {
    return undefined;
  }

  const entries: Record<string, ModelProperty>[] = [];

  for (const element of member.value.elements) {
    if (!isTypeObject(element) || !Array.isArray(element.members) || !element.members.every(isModelProperty)) {
      return undefined;
    }
    entries.push(Object.fromEntries(element.members.map((field) => [field.name, field])));
  }

  return entries;
};

/** A tuple of string literals, or undefined when the member is missing or any element is not a literal. */
const getLiteralStrings = (member: ModelProperty | undefined) => {
  const values = member && getPropertyStringList(member);
  if (!values || !isTypeTuple(member.value) || values.length !== member.value.elements.length) {
    return undefined;
  }
  return values;
};
