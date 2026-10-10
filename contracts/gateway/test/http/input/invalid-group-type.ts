import type { Http } from '@ez4/gateway';

// Missing Http.Group inheritance.
interface ChatGroup {
  memory: 512;
}

export declare class TestService extends Http.Service {
  routes: [
    Http.UseRoute<{
      path: 'GET /chat';
      handler: typeof listChat;
      group: 'chat';
    }>,
    Http.UseRoute<{
      path: 'GET /tags';
      handler: typeof listTags;
      group: 'tags';
    }>
  ];

  // @ts-expect-error No extra property is allowed.
  groups: {
    chat: ChatGroup;
    tags: {
      invalid_property: true;
    };
  };
}

function listChat(): Http.SuccessEmptyResponse {
  return {
    status: 204
  };
}

function listTags(): Http.SuccessEmptyResponse {
  return {
    status: 204
  };
}
