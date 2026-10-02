import type { Http } from '@ez4/gateway';

export declare class TestService extends Http.Service {
  routes: [];

  throttling: Http.UseThrottling<{
    // Zero would reject every request.
    rateLimit: 0;

    // Limits are whole requests.
    burstLimit: 2.5;
  }>;
}

export declare class TestNegativeService extends Http.Service {
  routes: [];

  throttling: Http.UseThrottling<{
    rateLimit: 10;
    burstLimit: -5;
  }>;
}
