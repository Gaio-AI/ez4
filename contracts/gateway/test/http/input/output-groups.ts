import type { ArchitectureType, LogLevel } from '@ez4/project';
import type { Http } from '@ez4/gateway';

export declare class TestService extends Http.Service {
  routes: [
    Http.UseRoute<{
      path: 'GET /tags';
      handler: typeof listTags;
      group: 'tags';
      // Same value the group resolves.
      memory: 512;
      variables: {
        TAGS_TABLE: 'tags';
      };
    }>,
    Http.UseRoute<{
      path: 'POST /tags';
      handler: typeof createTag;
      group: 'tags';
      variables: {
        TAGS_TABLE: 'tags';
        TAGS_LIMIT: '100';
      };
    }>,
    Http.UseRoute<{
      path: 'GET /audit';
      handler: typeof listAudit;
      group: 'audit';
      // Same value the service defaults give.
      logLevel: LogLevel.Information;
    }>,
    Http.UseRoute<{
      path: 'GET /health';
      handler: typeof health;
      memory: 1024;
    }>
  ];

  defaults: Http.UseDefaults<{
    logLevel: LogLevel.Information;
  }>;

  groups: {
    tags: {
      listener: typeof tagsListener;
      architecture: ArchitectureType.Arm;
      logRetention: 14;
      timeout: 10;
      memory: 512;
      files: ['path/to/file.json'];
      debug: false;
      vpc: false;
    };
  };
}

function tagsListener(): void {}

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

function listAudit(): Http.SuccessEmptyResponse {
  return {
    status: 204
  };
}

function health(): Http.SuccessEmptyResponse {
  return {
    status: 204
  };
}
