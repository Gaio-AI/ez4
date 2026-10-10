import type { HttpGroup, HttpRoute, HttpService } from '@ez4/gateway/library';
import type { DeployOptions, EventContext } from '@ez4/project/library';
import type { EntryStates } from '@ez4/state';
import type { IntegrationGroupRoute } from '../integration/function/types';
import type { GatewayState } from '../gateway/types';

import { getHttpGroupFunctionName } from '@ez4/gateway/library';
import { getServiceName } from '@ez4/project/library';
import { tryGetFunctionState } from '@ez4/aws-function';
import { deepMerge, isAnyObject } from '@ez4/utils';
import { isRoleState } from '@ez4/aws-identity';
import { createLogGroup } from '@ez4/aws-logs';

import { Defaults } from '../utils/defaults';
import { createIntegrationGroupFunction } from '../integration/function/service';
import { getIntegration, createIntegration } from '../integration/service';
import { getInternalName } from './utils/name';
import { mergeScopeHeaders } from './utils/scope';
import { RoleMissingError } from './errors';

/**
 * Integration of a route group: one function serves every route of the group, so the group's routes
 * share it and the integration, as routes of one handler do.
 */
export const getIntegrationGroupFunction = (
  state: EntryStates,
  service: HttpService,
  gatewayState: GatewayState,
  groupName: string,
  options: DeployOptions,
  context: EventContext
) => {
  if (!context.role || !isRoleState(context.role)) {
    throw new RoleMissingError();
  }

  const internalName = getInternalName(service, getHttpGroupFunctionName(groupName));

  let groupState = tryGetFunctionState(context, internalName, options);

  if (!groupState) {
    // Metadata already checked that every route of the group agrees on these.
    const defaults = deepMerge(options.defaults ?? {}, service.defaults ?? {});
    const group: HttpGroup = service.groups?.[groupName] ?? {};

    const {
      runtime = defaults.runtime ?? Defaults.Runtime,
      architecture = defaults.architecture ?? Defaults.Architecture,
      logRetention = defaults.logRetention ?? Defaults.LogRetention,
      logLevel = defaults.logLevel ?? Defaults.LogLevel,
      timeout = defaults.timeout ?? Defaults.Timeout,
      memory = defaults.memory ?? Defaults.Memory,
      debug = defaults.debug ?? options.debug,
      listener = defaults.listener,
      files = defaults.files,
      vpc
    } = group;

    const { release, tags } = options;

    // Sorted by code unit, so neither the declaration order nor the machine's locale changes the bundle.
    const groupRoutes = service.routes
      .filter((route) => route.group === groupName && !route.disabled)
      .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));

    const functionName = `${getServiceName(service, options)}-${getHttpGroupFunctionName(groupName)}`;

    const logGroupState = createLogGroup(state, {
      dependencies: [gatewayState.entryId],
      groupName: functionName,
      retention: logRetention,
      tags
    });

    groupState = createIntegrationGroupFunction(state, context.role, logGroupState, {
      groupName: internalName,
      functionName,
      // Not the route list, which would outgrow the description limits and change with every route.
      description: `Route group ${groupName}`,
      routes: groupRoutes.map((route) => getGroupRoute(route, defaults, context)),
      timeout: Math.max(5, timeout - 1),
      variables: [options.variables, service.variables, ...groupRoutes.map(getRouteVariables)],
      references: getGroupReferences(groupRoutes),
      context: service.context,
      dependencies: [gatewayState.entryId],
      listener: listener && {
        functionName: listener.name,
        sourceFile: listener.file,
        module: listener.module
      },
      systemLogLevel: options.defaults?.systemLogLevel,
      architecture,
      logLevel,
      runtime,
      release,
      memory,
      files,
      debug,
      tags,
      vpc
    });

    context.setServiceState(internalName, options, groupState);
  }

  return (
    getIntegration(state, gatewayState, groupState) ??
    createIntegration(state, gatewayState, groupState, {
      fromService: groupState.parameters.functionName,
      description: groupState.parameters.description,
      timeout: groupState.parameters.timeout
    })
  );
};

const getGroupRoute = (
  route: HttpRoute,
  defaults: Pick<HttpRoute, 'httpErrors' | 'preferences' | 'scope'>,
  context: EventContext
): IntegrationGroupRoute => {
  const { handler } = route;
  const { request, response } = handler;

  return {
    routeKey: route.path,
    handler: {
      sourceFile: handler.file,
      functionName: handler.name,
      module: handler.module,
      dependencies: context.getDependencyFiles(handler.file)
    },
    ...(request && {
      ...('headers' in request && { headersSchema: request.headers }),
      ...('query' in request && { querySchema: request.query }),
      ...('identity' in request && { identitySchema: request.identity }),
      ...('parameters' in request && { parametersSchema: request.parameters }),
      bodySchema: request.body
    }),
    responseSchema: response?.body,
    errorsMap: {
      ...(isAnyObject(defaults.httpErrors) && defaults.httpErrors),
      ...(isAnyObject(route.httpErrors) && route.httpErrors)
    },
    preferences: {
      ...defaults.preferences,
      ...route.preferences
    },
    scope: mergeScopeHeaders(defaults, route)
  };
};

// The order a handler's function gives them, which metadata checked to agree across the group.
const getRouteVariables = ({ handler, variables }: HttpRoute) => {
  return {
    ...(handler.provider && handler.provider.variables),
    ...variables
  };
};

// Every service the group's handlers use, or all of them once a handler doesn't say.
const getGroupReferences = (routes: HttpRoute[]) => {
  const references = new Set<string>();

  for (const { handler } of routes) {
    const handlerReferences = handler.references ?? (handler.provider?.services && Object.keys(handler.provider.services));

    if (!handlerReferences) {
      return undefined;
    }

    handlerReferences.forEach((reference) => references.add(reference));
  }

  return [...references].sort();
};
