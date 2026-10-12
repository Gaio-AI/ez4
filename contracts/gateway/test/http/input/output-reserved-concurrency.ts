import type { Http } from '@ez4/gateway';

export declare class TestService extends Http.Service {
  name: 'Remote API';

  routes: [
    Http.UseRoute<{
      name: 'signUp';
      path: 'POST /sign-up';
      handler: typeof signUp;
      reservedConcurrency: 5;
    }>,
    Http.UseRoute<{
      path: 'GET /tags';
      handler: typeof listTags;
      group: 'tags';
    }>,
    Http.UseRoute<{
      path: 'POST /tags';
      handler: typeof createTag;
      group: 'tags';
      // Same value the group gives.
      reservedConcurrency: 2;
    }>,
    Http.UseRoute<{
      path: 'GET /health';
      handler: typeof health;
    }>
  ];

  defaults: Http.UseDefaults<{
    memory: 256;
  }>;

  groups: {
    tags: {
      reservedConcurrency: 2;
    };
  };
}

function signUp(): Http.SuccessEmptyResponse {
  return {
    status: 204
  };
}

function listTags(): Http.SuccessEmptyResponse {
  return {
    status: 204
  };
}

function createTag(): Http.SuccessEmptyResponse {
  return {
    status: 204
  };
}

function health(): Http.SuccessEmptyResponse {
  return {
    status: 204
  };
}

// The reservation is how the owner deploys the route, so the import neither fails on it nor keeps it.
export declare class TestImport extends Http.Import<TestService> {
  project: 'name from project in ez4.project.js';
}
