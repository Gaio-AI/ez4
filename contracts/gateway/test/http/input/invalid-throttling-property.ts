import type { Http } from '@ez4/gateway';

export declare class TestService extends Http.Service {
  routes: [];

  throttling: Http.UseThrottling<{
    rateLimit: 10;
    burstLimit: 5;

    // No extra property is allowed.
    invalid_property: true;
  }>;
}
