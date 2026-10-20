import type { Http } from '@ez4/gateway';

export declare class TestService extends Http.Service {
  routes: [
    Http.UseRoute<{
      path: 'GET /items';
      handler: typeof listItems;
      allow: ['reader', 'writer'];
    }>,
    Http.UseRoute<{
      path: 'GET /items/all';
      handler: typeof listItems;
      // Same function as the route above, built with its value.
      allow: ['writer'];
    }>,
    Http.UseRoute<{
      path: 'GET /items/count';
      handler: typeof listItems;
      allow: ['reader', 'writer'];
    }>,
    Http.UseRoute<{
      path: 'GET /tags';
      handler: typeof listItems;
      group: 'tags';
      // A group serves each route with its own value.
      allow: ['admin'];
    }>
  ];

  defaults: Http.UseDefaults<{
    guard: typeof testGuard;
  }>;
}

function testGuard(): void {}

function listItems(): Http.SuccessEmptyResponse {
  return {
    status: 204
  };
}
