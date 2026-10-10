import type { NamingStyle } from '@ez4/schema';
import type { Http } from '@ez4/gateway';

import { getItem, createItem, health, itemsAuthorizer } from './plan-handlers';

/**
 * Service with routes of their own, as before route groups: what it plans can't change.
 */
export declare class PlanService extends Http.Service {
  name: 'Plan API';

  routes: [
    Http.UseRoute<{
      name: 'getItem';
      path: 'GET /items/{itemId}';
      handler: typeof getItem;
      httpErrors: {
        404: [ItemNotFoundError];
      };
      preferences: {
        strictQueryStrings: true;
      };
    }>,
    Http.UseRoute<{
      name: 'createItem';
      path: 'POST /items';
      handler: typeof createItem;
      authorizer: typeof itemsAuthorizer;
      memory: 512;
      timeout: 20;
      variables: {
        ITEMS_LIMIT: '100';
      };
    }>,
    Http.UseRoute<{
      path: 'GET /health';
      handler: typeof health;
    }>,
    Http.UseRoute<{
      path: 'HEAD /health';
      handler: typeof health;
      variables: {
        HEALTH_MODE: 'head';
      };
    }>
  ];

  defaults: Http.UseDefaults<{
    logRetention: 7;
    preferences: {
      namingStyle: NamingStyle.SnakeCase;
    };
    httpErrors: {
      409: [ItemConflictError];
    };
    scope: {
      clientVersion: 'x-client-version';
    };
  }>;

  variables: {
    SERVICE_NAME: 'plan';
  };
}

export class ItemNotFoundError extends Error {}

export class ItemConflictError extends Error {}
