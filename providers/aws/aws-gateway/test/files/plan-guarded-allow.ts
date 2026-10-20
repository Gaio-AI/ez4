import type { Http } from '@ez4/gateway';

import { listItems, listTags } from './plan-guarded-handlers';
import { roleGuard } from './plan-guard';

/**
 * The routes of `plan-guarded.ts`, where only what `GET /items` and `GET /tags` allow changed.
 */
export declare class GuardedService extends Http.Service {
  routes: [
    Http.UseRoute<{
      path: 'GET /items';
      handler: typeof listItems;
      allow: ['writer'];
    }>,
    Http.UseRoute<{
      path: 'GET /tags';
      handler: typeof listTags;
      group: 'tags';
      allow: ['admin'];
    }>,
    Http.UseRoute<{
      path: 'POST /tags';
      handler: typeof listTags;
      group: 'tags';
      allow: ['admin'];
    }>
  ];

  defaults: Http.UseDefaults<{
    guard: typeof roleGuard;
  }>;
}
