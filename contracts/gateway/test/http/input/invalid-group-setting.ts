import type { LogLevel } from '@ez4/project';
import type { Http } from '@ez4/gateway';

export declare class TestService extends Http.Service {
  routes: [
    Http.UseRoute<{
      path: 'GET /tags';
      handler: typeof listTags;
      group: 'tags';
      // The group gives 512.
      memory: 1024;
    }>,
    Http.UseRoute<{
      path: 'POST /tags';
      handler: typeof createTag;
      group: 'tags';
      // The defaults give information.
      logLevel: LogLevel.Debug;
    }>,
    Http.UseRoute<{
      path: 'DELETE /tags';
      handler: typeof deleteTag;
      group: 'tags';
      // Neither the group nor the defaults give one, so the first route would win.
      timeout: 20;
    }>,
    Http.UseRoute<{
      path: 'PUT /tags';
      handler: typeof updateTag;
      group: 'tags';
      // The group has another listener.
      listener: typeof otherListener;
    }>
  ];

  defaults: Http.UseDefaults<{
    logLevel: LogLevel.Information;
  }>;

  groups: {
    tags: {
      listener: typeof tagsListener;
      memory: 512;
    };
  };
}

function tagsListener(): void {}

function otherListener(): void {}

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

function deleteTag(): Http.SuccessEmptyResponse {
  return {
    status: 204
  };
}

function updateTag(): Http.SuccessEmptyResponse {
  return {
    status: 204
  };
}
