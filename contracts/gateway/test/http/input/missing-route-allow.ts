import type { Http } from '@ez4/gateway';

export declare class TestService extends Http.Service {
  routes: [
    Http.UseRoute<{
      path: 'GET /items';
      handler: typeof listItems;
      allow: 'reader';
    }>,
    Http.UseRoute<{
      path: 'POST /items';
      handler: typeof createItem;
      // The guard covers every route, so this one must say what it allows.
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
