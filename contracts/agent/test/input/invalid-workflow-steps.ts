import type { Agent } from '@ez4/agent';
import type { BasicAgent } from './output-basic-agent';

export declare class InvalidWorkflowSteps extends Agent.Workflow<{ issueId: string }, { round: number }, { worker: BasicAgent }> {
  input: { issueId: string };
  agents: {
    worker: BasicAgent;
  };
  maxSteps: 0;
  handler: typeof reviewLoopStep;
}

export declare function reviewLoopStep(request: Agent.WorkflowRequest<InvalidWorkflowSteps>): Agent.WorkflowStep<{ round: number }, { worker: BasicAgent }>;
