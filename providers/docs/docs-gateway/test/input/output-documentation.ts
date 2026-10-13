import type { Http } from '@ez4/gateway';
import type { String } from '@ez4/schema';

/**
 * Internal notes about how the service is built, which the document leaves out.
 *
 * @description Manage the items of an account.
 * @server https://api.example.com Production
 * @server https://sandbox.example.com
 */
export declare class TestApi extends Http.Service {
  name: 'Test API';

  routes: [
    Http.UseRoute<{
      path: 'PATCH /items/{itemId}';
      handler: typeof updateItemHandler;
    }>,
    Http.UseRoute<{
      path: 'GET /items';
      handler: typeof listItemsHandler;
    }>,
    Http.UseRoute<{
      path: 'DELETE /items/{itemId}';
      handler: typeof deleteItemHandler;
    }>
  ];
}

declare class UpdateItemRequest implements Http.Request {
  headers: {
    /**
     * The revision the change is based on.
     *
     * @required
     */
    'if-match'?: string;

    /**
     * A retry with the same key answers the first answer again.
     */
    'idempotency-key'?: string;
  };
  parameters: {
    /**
     * The item to change.
     */
    itemId: String.UUID;
  };
  body: {
    /**
     * Trimmed; unique in the account.
     */
    name?: string;
    tags?: string[];
  };
}

declare class UpdateItemResponse implements Http.Response {
  status: 200;
  body: {
    id: string;

    /**
     * Null at the top level.
     */
    parent_id: string | null;
  };
}

/**
 * Rename an item. Only the fields sent change;
 * a body with none changes nothing.
 *
 * @throws 404 No such item.
 */
function updateItemHandler(_request: UpdateItemRequest): UpdateItemResponse {
  return {
    status: 200,
    body: {
      id: 'id',
      parent_id: null
    }
  };
}

declare class ListItemsRequest implements Http.Request {
  query: {
    /**
     * Only the items filed directly in this folder.
     */
    folder?: string;
  };
}

declare class ListItemsResponse implements Http.Response {
  status: 200;
  body: {
    items: string[];
  };
}

/**
 * The account's items, oldest first.
 */
function listItemsHandler(_request: ListItemsRequest): ListItemsResponse {
  return {
    status: 200,
    body: {
      items: []
    }
  };
}

declare class DeleteItemRequest implements Http.Request {
  parameters: {
    itemId: String.UUID;
  };
}

/**
 * @summary Delete an item
 * @description Delete an item and everything filed in it.
 */
function deleteItemHandler(_request: DeleteItemRequest): Http.SuccessEmptyResponse {
  return {
    status: 204
  };
}
