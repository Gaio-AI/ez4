import type { SQSEvent } from 'aws-lambda';
import type { Agent } from '@ez4/agent';

import { handleWorkflowEvent } from '@ez4/aws-agent/library';

declare const __EZ4_CONTEXT: object;

declare function handle(request: Agent.WorkflowRequest<any>, context: object): Promise<Agent.WorkflowStep<unknown, any>>;

export async function workflowEntryPoint(event: SQSEvent): Promise<void> {
  await handleWorkflowEvent(event, (request) => handle(request, __EZ4_CONTEXT));
}
