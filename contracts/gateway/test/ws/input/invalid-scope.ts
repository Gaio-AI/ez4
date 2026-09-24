import type { Ws } from '@ez4/gateway';

export declare class TestService extends Ws.Service<{}> {
  // @ts-expect-error Scope headers must be strings.
  defaults: Ws.UseDefaults<{
    scope: {
      clientVersion: true;
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
