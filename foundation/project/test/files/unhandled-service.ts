import type { Cron } from '@ez4/scheduler';
import type { Http } from '@ez4/gateway';

// The test process loads no contract package, so nothing reads this service.
export declare class UnhandledCron extends Cron.Service {
  expression: 'rate(5 minutes)';

  target: Cron.UseTarget<{
    handler: typeof handleCron;
  }>;
}

// Implements a contract interface without being a service.
export declare class PlainRequest implements Http.Request {
  body: {
    value: string;
  };
}

export function handleCron(): void {}
