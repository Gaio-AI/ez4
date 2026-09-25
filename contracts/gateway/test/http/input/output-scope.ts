import type { Http } from '@ez4/gateway';

export declare class TestService extends Http.Service {
  defaults: Http.UseDefaults<{
    scope: {
      clientVersion: 'x-client-version';
      sessionId: 'x-session-id';
    };
  }>;

  routes: [
    Http.UseRoute<{
      path: 'GET /test-route';
      handler: typeof testRoute;
      scope: {
        sessionId: 'x-route-session-id';
      };
    }>
  ];
}

function testRoute(): Http.SuccessEmptyResponse {
  return {
    status: 204
  };
}
