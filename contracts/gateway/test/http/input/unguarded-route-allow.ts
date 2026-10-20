import type { Http } from '@ez4/gateway';

export declare class TestService extends Http.Service {
  routes: [
    Http.UseRoute<{
      path: 'GET /items';
      handler: typeof listItems;
      // No guard in the service enforces it.
      allow: 'reader';
    }>
  ];
}

function listItems(): Http.SuccessEmptyResponse {
  return {
    status: 204
  };
}
