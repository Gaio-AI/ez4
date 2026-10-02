import type { NamingStyle } from '@ez4/schema';
import type { Http } from '@ez4/gateway';

export declare class TestApi extends Http.Service {
  name: 'Test API';

  defaults: Http.UseDefaults<{
    preferences: {
      namingStyle: NamingStyle.SnakeCase;
    };
  }>;

  routes: [
    Http.UseRoute<{
      path: 'POST /items';
      handler: typeof testHandler;
    }>
  ];
}

declare class TestRequest implements Http.Request {
  body: {
    itemList: {
      itemName: string;
    }[];
  };
}

declare class TestResponse implements Http.Response {
  status: 200;
  body: {
    itemList: {
      itemName: string;
      tagList: {
        tagName: string;
      }[];
    }[];
  };
}

function testHandler(_request: TestRequest): TestResponse {
  return {
    status: 200,
    body: {
      itemList: []
    }
  };
}
