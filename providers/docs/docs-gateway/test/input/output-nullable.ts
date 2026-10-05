import type { Http } from '@ez4/gateway';

export declare class TestApi extends Http.Service {
  name: 'Test API';

  routes: [
    Http.UseRoute<{
      path: 'PATCH /items/{itemId}';
      handler: typeof updateItemHandler;
    }>
  ];
}

enum ItemColor {
  Red = 'red',
  Blue = 'blue'
}

enum ItemPriority {
  Low = 1,
  High = 2
}

interface ItemOwner {
  id: string;
  name: string | null;
}

interface ItemNode {
  name: string;
  parent: ItemNode | null;
}

declare class UpdateItemRequest implements Http.Request {
  headers: {
    'x-tenant': string | null;
    'x-trace'?: string;
  };
  parameters: {
    itemId: string;
  };
  query: {
    version: number | null;
    dry?: boolean;
  };
  body: {
    name: string | null;
    note?: string | null;
    label?: string;
    kind: 'item' | null;
    color: ItemColor | null;
    size: 'small' | 'large' | null;
    owner: ItemOwner | null;
    tags: (string | null)[] | null;
    value: string | number | null;
  };
}

declare class UpdateItemResponse implements Http.Response {
  status: 200;
  body: {
    id: string;
    name: string | null;
    note?: string | null;
    count: number | null;
    active: boolean | null;
    owner: ItemOwner | null;
    node: ItemNode;
    position: [number, number] | null;
    priority: ItemPriority | null;
    level: 'none' | 1 | null;
  };
}

function updateItemHandler(_request: UpdateItemRequest): UpdateItemResponse {
  return {
    status: 200,
    body: {
      id: 'foo',
      name: null,
      count: null,
      active: null,
      owner: null,
      node: {
        name: 'foo',
        parent: null
      },
      position: null,
      priority: null,
      level: null
    }
  };
}
