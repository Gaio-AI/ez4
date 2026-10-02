import type { Http } from '@ez4/gateway';

export declare class TestService extends Http.Service {
  routes: [
    Http.UseRoute<{
      path: 'GET /test-route-1';
      handler: typeof testRoute1;
    }>,
    Http.UseRoute<{
      path: 'GET /test-route-2';
      handler: typeof testRoute2;
    }>
  ];
}

/**
 * @summary Documented route.
 * @description Route with every documentation tag.
 * @deprecated Use the second route instead.
 * @tag Test Tag A
 * @tag Test Tag B
 */
function testRoute1(): Http.SuccessEmptyResponse {
  return {
    status: 204
  };
}

function testRoute2(): Http.SuccessEmptyResponse {
  return {
    status: 204
  };
}
