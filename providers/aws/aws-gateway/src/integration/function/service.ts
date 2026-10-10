import type { EntryState, EntryStates } from '@ez4/state';
import type { LinkedVariables } from '@ez4/project/library';
import type { RoleState } from '@ez4/aws-identity';
import type { LogGroupState } from '@ez4/aws-logs';
import type { IntegrationFunctionParameters, IntegrationGroupParameters } from './types';
import type { BundleFunction } from './bundler';

import { getDisabledProjects } from '@ez4/project/library';
import { createFunction } from '@ez4/aws-function';
import { arrayUnique, hashObject } from '@ez4/utils';
import { LogLevel } from '@ez4/project';

import {
  bundleConnectionFunction,
  bundleGroupFunction,
  bundleMessageFunction,
  bundleRequestFunction,
  getGroupTemplateFile,
  getIntegrationTemplateFile
} from './bundler';

import { IntegrationFunctionType } from './types';

const bundleFunctions: Record<IntegrationFunctionType, BundleFunction> = {
  [IntegrationFunctionType.HttpRequest]: bundleRequestFunction,
  [IntegrationFunctionType.WsConnection]: bundleConnectionFunction,
  [IntegrationFunctionType.WsMessage]: bundleMessageFunction
};

export const createIntegrationFunction = <E extends EntryState>(
  state: EntryStates<E>,
  roleState: RoleState,
  logGroupState: LogGroupState,
  parameters: IntegrationFunctionParameters
) => {
  const { headersSchema, parametersSchema, querySchema, bodySchema, identitySchema, responseSchema } = parameters;
  const { type, handler, variables, debug, architecture, preferences, errorsMap, scope } = parameters;

  return createFunction(state, roleState, logGroupState, {
    handlerName: 'apiEntryPoint',
    sourceFile: handler.sourceFile,
    dependencies: parameters.dependencies,
    functionName: parameters.functionName,
    description: parameters.description,
    logLevel: debug ? LogLevel.Debug : parameters.logLevel,
    systemLogLevel: parameters.systemLogLevel,
    architecture: parameters.architecture,
    runtime: parameters.runtime,
    release: parameters.release,
    timeout: parameters.timeout,
    memory: parameters.memory,
    files: parameters.files,
    tags: parameters.tags,
    vpc: parameters.vpc,
    getFunctionVariables: () => {
      return variables.reduce<LinkedVariables>((variables, current) => ({ ...variables, ...current }), {});
    },
    getFunctionBundle: (context) => {
      return bundleFunctions[type](parameters, [...context.getDependencies(), ...context.getConnections()]);
    },
    getFunctionFiles: () => {
      return [handler.sourceFile, [...handler.dependencies, getIntegrationTemplateFile(type)]];
    },
    getFunctionHash: () => {
      const disabledProjects = getDisabledProjects(parameters.context, parameters.references);

      return hashObject({
        architecture,
        headersSchema,
        parametersSchema,
        querySchema,
        bodySchema,
        identitySchema,
        responseSchema,
        preferences,
        errorsMap,
        scope,
        debug,
        ...(disabledProjects.length > 0 && {
          disabledProjects
        })
      });
    }
  });
};

/**
 * One function for every route of a group, which picks the route by the request's route key.
 */
export const createIntegrationGroupFunction = <E extends EntryState>(
  state: EntryStates<E>,
  roleState: RoleState,
  logGroupState: LogGroupState,
  parameters: IntegrationGroupParameters
) => {
  const { groupName, routes, listener, variables, debug, architecture } = parameters;

  return createFunction(state, roleState, logGroupState, {
    handlerName: 'apiEntryPoint',
    sourceFile: routes[0].handler.sourceFile,
    dependencies: parameters.dependencies,
    functionName: parameters.functionName,
    description: parameters.description,
    logLevel: debug ? LogLevel.Debug : parameters.logLevel,
    systemLogLevel: parameters.systemLogLevel,
    architecture: parameters.architecture,
    runtime: parameters.runtime,
    release: parameters.release,
    timeout: parameters.timeout,
    memory: parameters.memory,
    files: parameters.files,
    tags: parameters.tags,
    vpc: parameters.vpc,
    getFunctionVariables: () => {
      return variables.reduce<LinkedVariables>((variables, current) => ({ ...variables, ...current }), {});
    },
    getFunctionBundle: (context) => {
      return bundleGroupFunction(parameters, [...context.getDependencies(), ...context.getConnections()]);
    },
    getFunctionFiles: () => {
      const routeFiles = routes.flatMap(({ handler }) => handler.dependencies);

      return [groupName, [...arrayUnique(routeFiles), getGroupTemplateFile()]];
    },
    getFunctionHash: () => {
      const disabledProjects = getDisabledProjects(parameters.context, parameters.references);

      // The whole route table, handlers included, since one can change within files the source hash already
      // holds. Their import graph is the source hash's, so a new import leaves bytes alone to be skipped.
      const routeTable = routes.map(({ handler: { dependencies: _dependencies, ...handler }, ...route }) => ({ ...route, handler }));

      return hashObject({
        architecture,
        debug,
        listener,
        routes: routeTable,
        ...(disabledProjects.length > 0 && {
          disabledProjects
        })
      });
    }
  });
};
