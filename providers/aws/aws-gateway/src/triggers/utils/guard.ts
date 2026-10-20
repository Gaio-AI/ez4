import type { HttpDefaults, HttpRoute } from '@ez4/gateway/library';
import type { EventContext } from '@ez4/project/library';
import type { IntegrationGuard } from '../../integration/function/types';

/**
 * The service guard a route's handler runs behind, given the route's `allow`. Metadata already refused a guarded
 * route without `allow`.
 */
export const getRouteGuard = (
  defaults: Pick<HttpDefaults, 'guard'> | undefined,
  route: Pick<HttpRoute, 'allow'>,
  context: EventContext
): IntegrationGuard | undefined => {
  const guard = defaults?.guard;

  if (!guard || route.allow === undefined) {
    return undefined;
  }

  return {
    entrypoint: {
      sourceFile: guard.file,
      functionName: guard.name,
      module: guard.module,
      dependencies: context.getDependencyFiles(guard.file)
    },
    allow: route.allow
  };
};
