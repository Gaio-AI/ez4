import type { DeployOptions, ContextSource, EventContext } from '@ez4/project/library';
import type { HttpImport, HttpService } from '@ez4/gateway/library';
import type { GatewayState } from '../../gateway/types';

import { getClientAuthorization, getClientOperations, isHttpImport } from '@ez4/gateway/library';
import { getDefinitionName } from '@ez4/project/library';
import { toSnakeCase } from '@ez4/utils';

import { getGatewayState } from '../../gateway/utils';

export const prepareLinkedClient = (context: EventContext, service: HttpService | HttpImport, options: DeployOptions): ContextSource => {
  const gatewayState = getGatewayState(context, service.name, options);
  const gatewayId = gatewayState.entryId;

  const gatewayUrl = getDefinitionName<GatewayState>(gatewayId, 'endpoint');

  const authorization = isHttpImport(service) ? getClientAuthorization(service) : undefined;
  const authorizationVariable = `EZ4_HTTP_AUTHORIZATION_${toSnakeCase(service.name).toUpperCase()}`;

  // The key reaches the function as an environment variable instead of a literal in its bundle: build
  // outputs and copies of the code don't carry it, a new key updates the configuration without a rebuild,
  // and the plan and the state keep only a hash of each variable.
  const clientOptions =
    `{ operations: ${JSON.stringify(getClientOperations(service))}` +
    (authorization
      ? `, authorization: { header: ${JSON.stringify(authorization.header)}, value: process.env[${JSON.stringify(authorizationVariable)}] }`
      : '') +
    ' }';

  return {
    module: 'HttpClient',
    from: '@ez4/aws-gateway/client/http',
    constructor: `@{EZ4_MODULE_IMPORT}.make(${gatewayUrl}, ${clientOptions})`,
    dependencyIds: [gatewayId],
    connectionIds: [gatewayId],
    variables: authorization && {
      [authorizationVariable]: authorization.value
    }
  };
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
