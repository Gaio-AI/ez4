import type { Ws } from '@ez4/gateway';

export declare class TestService1 extends Ws.Service<{}> {
  defaults: Ws.UseDefaults<{
    scope: {
      clientVersion: 'x-client-version';
    };
  }>;

  connect: Ws.UseConnect<{
    handler: typeof connectHandler;
  }>;

  disconnect: Ws.UseDisconnect<{
    handler: typeof disconnectHandler;
  }>;

  message: Ws.UseMessage<{
    handler: typeof messageHandler;
  }>;
}

function connectHandler() {}

function disconnectHandler() {}

function messageHandler() {}
