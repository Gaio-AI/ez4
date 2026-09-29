import type { Environment, Service } from '@ez4/common';
import type { Http, HttpClient } from '@ez4/gateway';

export declare class RemoteService extends Http.Service {
  routes: [
    Http.UseRoute<{
      name: 'remoteRoute';
      path: 'GET /remote-route';
      handler: typeof remoteHandler;
    }>
  ];
}

function remoteHandler(): Http.SuccessEmptyResponse {
  return {
    status: 204
  };
}

export declare class RemoteImport extends Http.Import<RemoteService> {
  project: 'remote-project';

  client: HttpClient<RemoteImport>;
}

declare class LocalProvider implements Http.Provider {
  services: {
    remoteApi: Environment.Service<RemoteImport>;
  };
}

export declare class LocalService extends Http.Service {
  routes: [
    Http.UseRoute<{
      path: 'GET /local-route';
      handler: typeof localHandler;
    }>
  ];
}

function localHandler(_request: Http.Incoming<{}>, context: Service.Context<LocalProvider>): Http.SuccessEmptyResponse {
  context.remoteApi;

  return {
    status: 204
  };
}
