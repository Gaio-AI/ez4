type WsRequest = {
  connectionId: string;
};

declare global {
  var wsEvents: string[] | undefined;
}

export const recordConnect = (request: WsRequest) => {
  globalThis.wsEvents?.push(`connect ${request.connectionId}`);
};

export const recordDisconnect = (request: WsRequest) => {
  globalThis.wsEvents?.push(`disconnect ${request.connectionId}`);
};

export const recordMessage = (request: WsRequest) => {
  globalThis.wsEvents?.push(`message ${request.connectionId}`);
};
