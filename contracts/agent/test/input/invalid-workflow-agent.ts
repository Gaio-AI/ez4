import type { Agent } from '@ez4/agent';
import type { BasicAgent } from './output-basic-agent';

declare class NotAnAgent {}

// @ts-expect-error NotAnAgent does not satisfy WorkflowAgents constraint
export declare class InvalidWorkflowAgent extends Agent.Workflow<
  { issueId: string },
  { round: number },
  { worker: BasicAgent; ghost: NotAnAgent }
> {
  input: { issueId: string };
  agents: {
    worker: BasicAgent;
    ghost: NotAnAgent;
  };
  handler: typeof reviewLoopStep;
}

// @ts-expect-error NotAnAgent does not satisfy WorkflowAgents constraint
export declare function reviewLoopStep(
  request: Agent.WorkflowRequest<InvalidWorkflowAgent>
): Agent.WorkflowStep<{ round: number }, { worker: BasicAgent; ghost: NotAnAgent }>;
