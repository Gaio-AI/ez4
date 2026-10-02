import type { Http } from '@ez4/gateway';

export declare class TestService extends Http.Service {
  routes: [];

  throttling: TestThrottling;
}

// Concrete class is not allowed.
class TestThrottling implements Http.Throttling {
  rateLimit!: 10;
  burstLimit!: 5;
}
