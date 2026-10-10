import type { Http } from '@ez4/gateway';

export declare class TestService extends Http.Service {
  routes: [
    Http.UseRoute<{
      path: 'GET /tags';
      handler: typeof listTags;
      group: 'tags';
      variables: {
        TAGS_TABLE: 'tags';
        TAGS_LIMIT: '100';
      };
    }>,
    Http.UseRoute<{
      path: 'POST /tags';
      handler: typeof createTag;
      group: 'tags';
      variables: {
        TAGS_TABLE: 'other-tags';
        TAGS_LIMIT: '100';
      };
    }>,
    Http.UseRoute<{
      path: 'DELETE /tags';
      handler: typeof deleteTag;
      group: 'tags';
      variables: {
        TAGS_TABLE: 'third-tags';
      };
    }>,
    Http.UseRoute<{
      path: 'GET /audit';
      handler: typeof listAudit;
      // Other functions keep their own values.
      variables: {
        TAGS_TABLE: 'audit';
      };
    }>
  ];
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

function deleteTag(): Http.SuccessEmptyResponse {
  return {
    status: 204
  };
}

function listAudit(): Http.SuccessEmptyResponse {
  return {
    status: 204
  };
}
