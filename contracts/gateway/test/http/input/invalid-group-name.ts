import type { Http } from '@ez4/gateway';

export declare class TestService extends Http.Service {
  routes: [
    Http.UseRoute<{
      path: 'GET /tags';
      handler: typeof listTags;
      // test-service-group-... is longer than 64 characters.
      group: 'aGroupNameLongEnoughToPushTheFunctionNamePastTheLimit';
    }>
  ];
}

function listTags(): Http.SuccessEmptyResponse {
  return {
    status: 204
  };
}
