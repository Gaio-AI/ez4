import type { Agent } from '@ez4/agent';
import type { BasicAgent } from './output-basic-agent';

export declare class ReviewLoop extends Agent.Workflow<{ issueId: string }, { round: number }, { worker: BasicAgent }> {
  input: { issueId: string };
  agents: { worker: BasicAgent };
  maxSteps: 4;
  handler: typeof reviewLoopStep;
}

export function reviewLoopStep(request: Agent.WorkflowRequest<ReviewLoop>): Agent.WorkflowStep<{ round: number }, { worker: BasicAgent }> {
  const event = request.event;
  if (event.type === 'start') {
    return { state: { round: 0 }, next: { invoke: 'worker', input: { prompt: event.input.issueId } } };
  }
  return { state: { round: 1 }, next: { complete: 'done' } };
}
