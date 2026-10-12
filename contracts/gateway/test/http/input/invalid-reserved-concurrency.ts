import type { Http } from '@ez4/gateway';

export declare class TestService extends Http.Service {
  routes: [
    Http.UseRoute<{
      path: 'POST /sign-up';
      handler: typeof testRoute;
      // Zero would fail every request.
      reservedConcurrency: 0;
    }>,
    Http.UseRoute<{
      path: 'POST /sign-in';
      handler: typeof testRoute;
      // Executions are whole.
      reservedConcurrency: 2.5;
    }>,
    Http.UseRoute<{
      path: 'GET /tags';
      handler: typeof testRoute;
      group: 'tags';
    }>
  ];

  groups: {
    tags: {
      reservedConcurrency: -1;
    };
  };
}

function testRoute(): Http.SuccessEmptyResponse {
  return {
    status: 204
  };
}
