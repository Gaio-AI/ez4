import type { Http } from '@ez4/gateway';

export declare class TestService extends Http.Service {
  routes: [
    Http.UseRoute<{
      path: 'GET /items';
      handler: typeof listItems;
      // Any string, not a value the guard can be given.
      allow: string;
    }>,
    Http.UseRoute<{
      path: 'POST /items';
      handler: typeof createItem;
      allow: ['writer', number];
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

function createItem(): Http.SuccessEmptyResponse {
  return {
    status: 204
  };
}
