import type { Http } from '@ez4/gateway';

export declare class TestService extends Http.Service {
  name: 'Remote API';

  routes: [
    Http.UseRoute<{
      name: 'testRoute';
      path: 'GET /test-route';
      handler: typeof testHandler;
      group: 'remote';
    }>
  ];

  defaults: Http.UseDefaults<{
    memory: 256;
  }>;

  groups: {
    remote: {
      memory: 512;
    };
  };
}

function testHandler(): Http.SuccessEmptyResponse {
  return {
    status: 204
  };
}

// The group is how the owner deploys the route, so the import neither fails on it nor keeps it.
export declare class TestImport extends Http.Import<TestService> {
  project: 'name from project in ez4.project.js';
}
