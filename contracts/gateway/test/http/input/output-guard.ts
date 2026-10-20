import type { Http } from '@ez4/gateway';

enum Role {
  Reader = 'reader',
  Writer = 'writer'
}

type Readers = [Role.Reader, Role.Writer];

type Allow = Role | Readers | 'public' | { owner: true; level: 2 };

/**
 * @description Service for testing route guard.
 */
export declare class TestService extends Http.Service {
  routes: [
    Http.UseRoute<{
      path: 'GET /items';
      handler: typeof listItems;
      allow: Readers;
    }>,
    Http.UseRoute<{
      path: 'GET /items/count';
      handler: typeof listItems;
      allow: Readers;
    }>,
    Http.UseRoute<{
      path: 'POST /items';
      handler: typeof createItem;
      allow: Role.Writer;
    }>,
    Http.UseRoute<{
      path: 'GET /health';
      handler: typeof health;
      allow: 'public';
    }>,
    Http.UseRoute<{
      path: 'DELETE /items';
      handler: typeof deleteItems;
      allow: { owner: true; level: 2 };
    }>,
    Http.UseRoute<{
      path: 'GET /tags';
      handler: typeof listItems;
      group: 'tags';
      allow: [Role.Reader];
    }>
  ];

  defaults: Http.UseDefaults<{
    guard: typeof testGuard;
  }>;
}

function testGuard(_request: Http.Incoming<Http.Request>, _allow: Allow): void {}

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

function deleteItems(): Http.SuccessEmptyResponse {
  return {
    status: 204
  };
}

function health(): Http.SuccessEmptyResponse {
  return {
    status: 204
  };
}
