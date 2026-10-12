import type { DeployOptions, ContextSource, EventContext, LinkedVariables } from '@ez4/project/library';
import type { HttpImport, HttpService } from '@ez4/gateway/library';
import type { GatewayState } from '../../gateway/types';

import { getClientAuthorization, getClientOperations, isHttpImport } from '@ez4/gateway/library';
import { getDefinitionName } from '@ez4/project/library';
import { toSnakeCase } from '@ez4/utils';

import { getGatewayState } from '../../gateway/utils';

export const prepareLinkedClient = (
  context: EventContext,
  service: HttpService | HttpImport,
  options: DeployOptions,
  targetVariables?: LinkedVariables
): ContextSource => {
  const gatewayState = getGatewayState(context, service.name, options);
  const gatewayId = gatewayState.entryId;

  const gatewayUrl = getDefinitionName<GatewayState>(gatewayId, 'endpoint');

  const authorization = isHttpImport(service) ? getAuthorizationSource(service, options, targetVariables) : undefined;

  const clientOptions =
    `{ operations: ${JSON.stringify(getClientOperations(service))}` +
    (authorization
      ? `, authorization: { header: ${JSON.stringify(authorization.header)}, ` +
        `value: ${JSON.stringify(authorization.prefix)} + process.env[${JSON.stringify(authorization.variable)}] }`
      : '') +
    ' }';

  return {
    module: 'HttpClient',
    from: '@ez4/aws-gateway/client/http',
    constructor: `@{EZ4_MODULE_IMPORT}.make(${gatewayUrl}, ${clientOptions})`,
    dependencyIds: [gatewayId],
    connectionIds: [gatewayId],
    variables: authorization?.variables
  };
};

// The key reaches the function as an environment variable instead of a literal in its bundle: build outputs and
// copies of the code don't carry it, a new key updates the configuration without a rebuild, and the plan and the
// state keep only a hash of each variable. Every function of the linking service carries the variables of the
// service and of the project, and Lambda caps them at 4 KB, so a key one of them already holds is read from that
// variable instead of being added again.
const getAuthorizationSource = (service: HttpImport, options: DeployOptions, targetVariables?: LinkedVariables) => {
  const authorization = getClientAuthorization(service);

  if (!authorization || !service.authorization) {
    return undefined;
  }

  const { header, value } = authorization;
  const { value: key } = service.authorization;

  const prefix = value.slice(0, value.length - key.length);

  const declaredVariables = { ...options.variables, ...targetVariables };
  const declaredVariable = Object.keys(declaredVariables).find((name) => declaredVariables[name] === key);

  if (declaredVariable) {
    return { header, prefix, variable: declaredVariable };
  }

  const variable = `EZ4_HTTP_AUTHORIZATION_${toSnakeCase(service.name).toUpperCase()}`;

  return { header, prefix, variable, variables: { [variable]: key } };
};

export const prepareDisabledClient = (service: HttpImport): ContextSource => {
  // Without a gateway there's no endpoint to depend on or to call.
  const clientOptions = JSON.stringify({
    operations: getClientOperations(service),
    disabledProject: service.project
  });

  return {
    module: 'HttpClient',
    from: '@ez4/aws-gateway/client/http',
    constructor: `@{EZ4_MODULE_IMPORT}.make('', ${clientOptions})`,
    disabledProject: service.project
  };
};
