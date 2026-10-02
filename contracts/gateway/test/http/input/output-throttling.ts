import type { Http } from '@ez4/gateway';

export declare class TestService extends Http.Service {
  routes: [];

  // Throttling configuration.
  throttling: Http.UseThrottling<{
    rateLimit: 100;
    burstLimit: 50;
  }>;
}
