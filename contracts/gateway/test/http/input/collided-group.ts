import type { Http } from '@ez4/gateway';

export declare class TestService extends Http.Service {
  routes: [
    Http.UseRoute<{
      path: 'GET /tags';
      handler: typeof groupTags;
    }>,
    Http.UseRoute<{
      path: 'POST /tags';
      handler: typeof createTag;
      // Its function would be test-service-group-tags, the function of the handler above.
      group: 'tags';
    }>,
    Http.UseRoute<{
      path: 'GET /help';
      handler: typeof listHelp;
      group: 'helpCenter';
    }>,
    Http.UseRoute<{
      path: 'POST /help';
      handler: typeof createHelp;
      // Both names turn into test-service-group-help-center.
      group: 'help-center';
    }>
  ];
}

function groupTags(): Http.SuccessEmptyResponse {
  return {
    status: 204
  };
}

function createTag(): Http.SuccessEmptyResponse {
  return {
    status: 204
  };
}

function listHelp(): Http.SuccessEmptyResponse {
  return {
    status: 204
  };
}

function createHelp(): Http.SuccessEmptyResponse {
  return {
    status: 204
  };
}
