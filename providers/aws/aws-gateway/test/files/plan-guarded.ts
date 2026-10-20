import type { Http } from '@ez4/gateway';

import { listItems, listTags } from './plan-guarded-handlers';
import { roleGuard } from './plan-guard';

export declare class GuardedService extends Http.Service {
  routes: [
    Http.UseRoute<{
      path: 'GET /items';
      handler: typeof listItems;
      allow: ['reader', 'writer'];
    }>,
    Http.UseRoute<{
      path: 'GET /tags';
      handler: typeof listTags;
      group: 'tags';
      allow: ['writer'];
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
