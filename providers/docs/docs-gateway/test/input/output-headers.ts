import type { Http } from '@ez4/gateway';

export declare class TestApi extends Http.Service {
  name: 'Test API';

  routes: [
    Http.UseRoute<{
      path: 'GET /items';
      handler: typeof listItemsHandler;
    }>,
    Http.UseRoute<{
      path: 'DELETE /items';
      handler: typeof deleteItemsHandler;
    }>
  ];
}

declare class ListItemsResponse implements Http.Response {
  status: 200;
  headers: {
    /**
     * @description Requests left in the current window.
     */
    'ratelimit-remaining': string;
    'x-cache'?: string;
    'x-next-cursor': string | null;
  };
  body: {
    items: string[];
  };
}

function listItemsHandler(): ListItemsResponse {
  return {
    status: 200,
    headers: {
      'ratelimit-remaining': '10',
      'x-next-cursor': null
    },
    body: {
      items: []
    }
  };
}

declare class DeleteItemsResponse implements Http.Response {
  status: 202 | 204;
  headers: {
    location: string;
  };
}

function deleteItemsHandler(): DeleteItemsResponse {
  return {
    status: 204,
    headers: {
      location: '/items'
    }
  };
}
