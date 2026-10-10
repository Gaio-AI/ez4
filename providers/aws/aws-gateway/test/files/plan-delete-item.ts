import type { Http } from '@ez4/gateway';

declare class DeleteItemRequest implements Http.Request {
  parameters: {
    itemId: string;
  };
}

export function deleteItem(_request: Http.Incoming<DeleteItemRequest>): Http.SuccessEmptyResponse {
  return {
    status: 204
  };
}
