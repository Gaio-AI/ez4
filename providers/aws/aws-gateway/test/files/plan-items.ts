import type { Http } from '@ez4/gateway';

import { getItem, createItem, health, itemsAuthorizer } from './plan-handlers';
import { deleteItem } from './plan-delete-item';

/**
 * The items routes with a function each, before they move to a group.
 */
export declare class ItemsService extends Http.Service {
  routes: [
    Http.UseRoute<{
      path: 'GET /items/{itemId}';
      handler: typeof getItem;
      variables: {
        ITEMS_TABLE: 'items';
      };
    }>,
    Http.UseRoute<{
      path: 'POST /items';
      handler: typeof createItem;
      authorizer: typeof itemsAuthorizer;
      variables: {
        ITEMS_LIMIT: '100';
      };
    }>,
    Http.UseRoute<{
      path: 'DELETE /items/{itemId}';
      handler: typeof deleteItem;
    }>,
    Http.UseRoute<{
      path: 'GET /health';
      handler: typeof health;
    }>
  ];
}
