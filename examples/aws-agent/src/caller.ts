import { Cron } from '@ez4/scheduler';
import { Environment, type Service } from '@ez4/common';
import type { EchoFlow } from './agent';

export declare class PeriodicCaller extends Cron.Service {
  expression: 'rate(1 hour)';
  target: Cron.UseTarget<{
    handler: typeof callerHandler;
  }>;
  services: {
    echoFlow: Environment.Service<EchoFlow>;
  };
}

export const callerHandler = async (_request: Cron.Incoming<null>, context: Service.Context<PeriodicCaller>): Promise<void> => {
  const { runId } = await context.echoFlow.start({ text: 'scheduled ping' });
  console.log(`Started echo workflow ${runId}`);
};
