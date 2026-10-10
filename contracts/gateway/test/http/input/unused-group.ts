import type { Http } from '@ez4/gateway';

export declare class TestService extends Http.Service {
  routes: [
    Http.UseRoute<{
      path: 'GET /chat';
      handler: typeof listChat;
      group: 'chat';
    }>
  ];

  groups: {
    // A typo: no route is in `chats`, so its memory would never apply.
    chats: {
      memory: 512;
    };
  };
}

function listChat(): Http.SuccessEmptyResponse {
  return {
    status: 204
  };
}
