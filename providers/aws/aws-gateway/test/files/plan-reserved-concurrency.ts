import type { Http } from '@ez4/gateway';

import { getItem, createItem, health } from './plan-handlers';
import { deleteItem } from './plan-delete-item';

/**
 * A route of its own function and a group that reserve concurrency, and a route that doesn't.
 */
export declare class ItemsService extends Http.Service {
  routes: [
    Http.UseRoute<{
      path: 'GET /items/{itemId}';
      handler: typeof getItem;
      group: 'items';
    }>,
    Http.UseRoute<{
      path: 'DELETE /items/{itemId}';
      handler: typeof deleteItem;
      group: 'items';
    }>,
    Http.UseRoute<{
      path: 'POST /items';
      handler: typeof createItem;
      reservedConcurrency: 5;
    }>,
    Http.UseRoute<{
      path: 'GET /health';
      handler: typeof health;
    }>
  ];

  groups: {
    items: {
      reservedConcurrency: 2;
    };
  };
}
