import type { Http } from '@ez4/gateway';

export declare class TestService extends Http.Service {
  // @ts-expect-error Scope headers must be strings.
  defaults: Http.UseDefaults<{
    scope: {
      clientVersion: 123;
    };
  }>;

  routes: [];
}
