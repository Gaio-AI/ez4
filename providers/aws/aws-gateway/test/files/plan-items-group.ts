import type { Http } from '@ez4/gateway';

import { getItem, createItem, health, itemsAuthorizer } from './plan-handlers';
import { deleteItem } from './plan-delete-item';

/**
 * The items routes of `plan-items.ts` moved to one group.
 */
export declare class ItemsService extends Http.Service {
  routes: [
    Http.UseRoute<{
      path: 'GET /items/{itemId}';
      handler: typeof getItem;
      group: 'items';
      variables: {
        ITEMS_TABLE: 'items';
      };
    }>,
    Http.UseRoute<{
      path: 'POST /items';
      handler: typeof createItem;
      authorizer: typeof itemsAuthorizer;
      group: 'items';
      variables: {
        ITEMS_LIMIT: '100';
      };
    }>,
    Http.UseRoute<{
      path: 'DELETE /items/{itemId}';
      handler: typeof deleteItem;
      group: 'items';
    }>,
    Http.UseRoute<{
      path: 'GET /health';
      handler: typeof health;
    }>
  ];

  groups: {
    items: {
      memory: 512;
      timeout: 15;
    };
  };
}
