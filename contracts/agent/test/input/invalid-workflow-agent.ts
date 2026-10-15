import type { Agent } from '@ez4/agent';
import type { BasicAgent } from './output-basic-agent';

declare class NotAnAgent {}

export declare class InvalidWorkflowAgent extends Agent.Workflow<
  { issueId: string },
  { round: number },
  // @ts-expect-error NotAnAgent does not satisfy WorkflowAgents constraint
  { worker: BasicAgent; ghost: NotAnAgent }
> {
  input: { issueId: string };
  agents: {
    worker: BasicAgent;
    ghost: NotAnAgent;
  };
  handler: typeof reviewLoopStep;
}

export declare function reviewLoopStep(
  request: Agent.WorkflowRequest<InvalidWorkflowAgent>
  // @ts-expect-error NotAnAgent does not satisfy WorkflowAgents constraint
): Agent.WorkflowStep<{ round: number }, { worker: BasicAgent; ghost: NotAnAgent }>;
