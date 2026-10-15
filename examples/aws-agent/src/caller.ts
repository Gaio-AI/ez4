import { Cron } from '@ez4/scheduler';
import { Environment, type Service } from '@ez4/common';
import type { EchoFlow, LogsFlow } from './agent';

export declare class PeriodicCaller extends Cron.Service {
  expression: 'rate(1 hour)';
  target: Cron.UseTarget<{
    handler: typeof callerHandler;
  }>;
  services: {
    echoFlow: Environment.Service<EchoFlow>;
    logsFlow: Environment.Service<LogsFlow>;
  };
}

export async function callerHandler(_request: Cron.Incoming<null>, context: Service.Context<PeriodicCaller>): Promise<void> {
  const { runId } = await context.echoFlow.start({ text: 'scheduled ping' });
  console.log(`Started echo workflow ${runId}`);

  // The second group is outside the agent's grant, so reading it must be denied.
  const logs = await context.logsFlow.start({ logGroups: ['ez4-aws-agent-app-orders', 'ez4-other-app-orders'] });
  console.log(`Started logs workflow ${logs.runId}`);
}
