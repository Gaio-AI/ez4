import type { Http } from '@ez4/gateway';

// Missing Http.Throttling inheritance.
declare class TestThrottling {
  rateLimit: 10;
  burstLimit: 5;
}

export declare class TestService extends Http.Service {
  routes: [];

  throttling: TestThrottling;
}
