import type { AllType, ReflectionTypes, TypeModel } from '@ez4/reflection';
import type { MemberType } from '@ez4/common/library';
import type { HttpGroup, HttpService } from './types';

import {
  InvalidServicePropertyError,
  isModelDeclaration,
  getPropertyNumber,
  getPropertyStringList,
  getPropertyBoolean,
  getObjectMembers,
  getModelMembers,
  getServiceListener,
  getServiceArchitecture,
  getServiceLogLevel,
  getServiceRuntime,
  tryGetReferenceType,
  hasHeritageType
} from '@ez4/common/library';

import { isModelProperty, isTypeObject, isTypeReference } from '@ez4/reflection';
import { deepEqual, isAnyObject, toKebabCase } from '@ez4/utils';

import {
  ConflictingGroupVariableError,
  GroupNameCollisionError,
  IncorrectGroupTypeError,
  InvalidGroupNameError,
  InvalidGroupTypeError,
  InvalidRouteGroupError,
  UnusedGroupError
} from '../../errors/http/group';

import { getFullTypeName } from '../utils/name';
import { HttpNamespaceType } from './types';

const FULL_BASE_TYPE = getFullTypeName(HttpNamespaceType, 'Group');

// Settings of the function, which every route of a group shares.
const GROUP_SETTINGS = [
  'listener',
  'architecture',
  'runtime',
  'logRetention',
  'logLevel',
  'timeout',
  'memory',
  'files',
  'debug',
  'vpc'
] as const;

// Lambda's limit for a function name.
const MAX_FUNCTION_NAME = 64;

export const isHttpGroupDeclaration = (type: TypeModel) => {
  return hasHeritageType(type, FULL_BASE_TYPE);
};

/**
 * Name of a group's function within its service, the same way a handler's function is named.
 */
export const getHttpGroupFunctionName = (groupName: string) => {
  return `group-${toKebabCase(groupName)}`;
};

export const getHttpGroupsMetadata = (type: AllType, parent: TypeModel, reflection: ReflectionTypes, errorList: Error[]) => {
  const groupsType = isTypeReference(type) ? tryGetReferenceType(type, reflection) : type;

  if (!groupsType || !isTypeObject(groupsType)) {
    errorList.push(new InvalidGroupTypeError(parent.file));
    return undefined;
  }

  const groups: Record<string, HttpGroup> = {};

  for (const member of getObjectMembers(groupsType)) {
    if (!isModelProperty(member)) {
      continue;
    }

    const group = getGroupMetadata(member.value, parent, reflection, errorList);

    if (group) {
      groups[member.name] = group;
    }
  }

  return groups;
};

const getGroupMetadata = (type: AllType, parent: TypeModel, reflection: ReflectionTypes, errorList: Error[]) => {
  const groupType = isTypeReference(type) ? tryGetReferenceType(type, reflection) : type;

  if (groupType && isTypeObject(groupType)) {
    return getTypeFromMembers(parent, getObjectMembers(groupType), errorList);
  }

  if (!groupType || !isModelDeclaration(groupType)) {
    errorList.push(new InvalidGroupTypeError(parent.file));
    return undefined;
  }

  if (!isHttpGroupDeclaration(groupType)) {
    errorList.push(new IncorrectGroupTypeError(groupType.name, parent.file));
    return undefined;
  }

  return getTypeFromMembers(parent, getModelMembers(groupType), errorList);
};

const getTypeFromMembers = (parent: TypeModel, members: MemberType[], errorList: Error[]) => {
  const group: HttpGroup = {};

  for (const member of members) {
    if (!isModelProperty(member) || member.inherited) {
      continue;
    }

    switch (member.name) {
      default: {
        errorList.push(new InvalidServicePropertyError(parent.name, member.name, parent.file));
        break;
      }

      case 'memory':
      case 'timeout':
      case 'logRetention': {
        group[member.name] = getPropertyNumber(member);
        break;
      }

      case 'logLevel': {
        group[member.name] = getServiceLogLevel(member);
        break;
      }

      case 'architecture': {
        group[member.name] = getServiceArchitecture(member);
        break;
      }

      case 'runtime': {
        group[member.name] = getServiceRuntime(member);
        break;
      }

      case 'files': {
        group[member.name] = getPropertyStringList(member);
        break;
      }

      case 'vpc':
      case 'debug': {
        group[member.name] = getPropertyBoolean(member);
        break;
      }

      case 'listener': {
        group.listener = getServiceListener(member.value, errorList);
        break;
      }
    }
  }

  return group;
};

/**
 * Check the route groups of a service: one function serves all routes of a group, so its settings and
 * environment have to hold for every one of them, and its name has to be its own.
 */
export const checkHttpRouteGroups = (service: HttpService, errorList: Error[]) => {
  const { name: serviceName, file: fileName, defaults, routes } = service;

  const groupRoutes = new Map<string, HttpService['routes']>();

  for (const route of routes) {
    if (route.group) {
      groupRoutes.set(route.group, [...(groupRoutes.get(route.group) ?? []), route]);
    }
  }

  for (const groupName in service.groups) {
    if (!groupRoutes.has(groupName)) {
      errorList.push(new UnusedGroupError(groupName, fileName));
    }
  }

  const functionNames = new Set<string>();

  for (const { handler, authorizer } of routes) {
    functionNames.add(toKebabCase(handler.name));

    if (authorizer) {
      functionNames.add(toKebabCase(authorizer.name));
    }
  }

  for (const [groupName, members] of groupRoutes) {
    const functionName = getHttpGroupFunctionName(groupName);

    if (`${toKebabCase(serviceName)}-${functionName}`.length > MAX_FUNCTION_NAME) {
      errorList.push(new InvalidGroupNameError(groupName, functionName, fileName));
    }

    // Two group names can turn into the same function name too.
    if (functionNames.has(functionName)) {
      errorList.push(new GroupNameCollisionError(groupName, functionName, fileName));
    } else {
      functionNames.add(functionName);
    }

    const group = service.groups?.[groupName] ?? {};

    for (const setting of GROUP_SETTINGS) {
      const groupValue = group[setting] ?? (setting !== 'vpc' ? defaults?.[setting] : undefined);

      for (const route of members) {
        const routeValue = route[setting];

        if (routeValue !== undefined && !isSameSetting(routeValue, groupValue)) {
          errorList.push(new InvalidRouteGroupError(groupName, route.path, setting, fileName));
        }
      }
    }

    const variables = new Map<string, string>();
    const conflicts = new Set<string>();

    for (const { handler, variables: routeVariables } of members) {
      // The same order a function gives the variables of its handler.
      const allVariables = { ...handler.provider?.variables, ...routeVariables };

      for (const variableName in allVariables) {
        const value = allVariables[variableName];
        const groupValue = variables.get(variableName);

        if (groupValue === undefined) {
          variables.set(variableName, value);
        } else if (groupValue !== value && !conflicts.has(variableName)) {
          errorList.push(new ConflictingGroupVariableError(groupName, variableName, fileName));
          conflicts.add(variableName);
        }
      }
    }
  }
};

const isSameSetting = (routeValue: unknown, groupValue: unknown) => {
  if ((isAnyObject(routeValue) || Array.isArray(routeValue)) && (isAnyObject(groupValue) || Array.isArray(groupValue))) {
    return deepEqual(routeValue, groupValue);
  }

  return routeValue === groupValue;
};
