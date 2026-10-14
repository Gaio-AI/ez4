import { Queue } from '@ez4/queue';
import { Cron } from '@ez4/scheduler';
import { Environment, type Service } from '@ez4/common';
import type { Agent } from '@ez4/agent';
import type { EchoAgent } from './agent';

// Caller queue receives Agent.Result<EchoAgent>
export declare class EchoResultsQueue extends Queue.Ordered<Agent.Result<EchoAgent>> {
  fifoMode: Queue.UseFifoMode<{
    groupId: 'agent';
    uniqueId: 'id';
  }>;
  subscriptions: [
    Queue.UseSubscription<{
      handler: typeof resultHandler;
    }>
  ];
}

export declare class PeriodicCaller extends Cron.Service {
  expression: 'rate(1 hour)';
  target: Cron.UseTarget<{
    handler: typeof callerHandler;
  }>;
  services: {
    echoAgent: Environment.Service<EchoAgent, { replyTo: 'EchoResultsQueue' }>;
    resultsQueue: EchoResultsQueue;
  };
}

export const callerHandler = async (request: Cron.Incoming<null>, context: Service.Context<PeriodicCaller>): Promise<void> => {
  const invocation = await context.echoAgent.invoke(
    { message: 'scheduled ping' },
    { correlation: JSON.stringify({ requestId: request.requestId }) }
  );
  console.log(`Dispatched agent task ${invocation.id}`);
};

export const resultHandler = async (request: Queue.Incoming<Agent.Result<EchoAgent>>): Promise<void> => {
  console.log(`Received agent result ${request.message.id}: status=${request.message.status}`);
};
