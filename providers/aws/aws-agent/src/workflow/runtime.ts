import type { Agent } from '@ez4/agent';
import { WorkflowEventType, WorkflowRunStatus } from '@ez4/agent';

export type WorkflowStore = {
  read(runId: string): Promise<{ run: Agent.WorkflowRun<unknown>; etag: string } | undefined>;
  /** etag undefined = create (If-None-Match: *); returns false on precondition failure. */
  write(run: Agent.WorkflowRun<unknown>, etag: string | undefined): Promise<boolean>;
};

export type WorkflowInvoker = (agent: string, input: unknown, options: Agent.InvokeOptions) => Promise<{ id: string }>;

export type WorkflowMessage =
  | { type: WorkflowEventType.Start; runId: string; input: unknown }
  | { type: WorkflowEventType.Result; result: Agent.Result<any> };

export class WorkflowConflictError extends Error {
  constructor(message?: string) {
    super(message ?? 'Workflow conflict');
    this.name = 'WorkflowConflictError';
  }
}

export interface RunWorkflowStepParameters {
  workflow: string;
  maxSteps: number;
  message: WorkflowMessage;
  handler: (request: Agent.WorkflowRequest<any>) => Promise<Agent.WorkflowStep<unknown, any>> | Agent.WorkflowStep<unknown, any>;
  store: WorkflowStore;
  invoke: WorkflowInvoker;
  newId: () => string;
  now: () => Date;
}

export type WorkflowStepResult = 'started' | 'advanced' | 'completed' | 'failed' | 'reinvoked' | 'ignored';

export const runWorkflowStep = async (params: RunWorkflowStepParameters): Promise<WorkflowStepResult> => {
  let runId: string;
  let key: string;
  let event: Agent.WorkflowRequest<any>['event'];

  if (params.message.type === WorkflowEventType.Start) {
    runId = params.message.runId;
    key = 'start';
    event = {
      type: WorkflowEventType.Start,
      input: params.message.input as Agent.Input
    };
  } else {
    const rawCorrelation = params.message.result.correlation;
    if (!rawCorrelation) {
      return 'ignored';
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawCorrelation);
    } catch {
      return 'ignored';
    }
    if (!parsed || typeof parsed !== 'object') {
      return 'ignored';
    }
    if (!('workflow' in parsed) || parsed.workflow !== params.workflow) {
      return 'ignored';
    }
    if (!('runId' in parsed) || typeof parsed.runId !== 'string' || !parsed.runId) {
      return 'ignored';
    }
    runId = parsed.runId;
    key = params.message.result.id;
    event = {
      type: WorkflowEventType.Result,
      agent: params.message.result.agent,
      result: params.message.result
    };
  }

  const stored = await params.store.read(runId);
  const run = stored?.run;
  const etag = stored?.etag;

  // Rule 1: Result for a run that does not exist → ignored
  if (params.message.type === WorkflowEventType.Result && !run) {
    return 'ignored';
  }

  // Rule 2: Run completed/failed → ignored
  if (run && (run.status === WorkflowRunStatus.Completed || run.status === WorkflowRunStatus.Failed)) {
    return 'ignored';
  }

  // Rule 3: Event key = 'start' or result.id. If run.trigger === key and run.waitingFor → invoke again → reinvoked
  if (run && run.trigger === key && run.waitingFor) {
    const correlation = JSON.stringify({
      workflow: params.workflow,
      runId,
      step: run.step
    });
    await params.invoke(run.waitingFor.agent, run.waitingFor.input, {
      id: run.waitingFor.id,
      correlation,
      workspace: run.waitingFor.workspace
    });
    return 'reinvoked';
  }

  // Rule 4: Result with run.waitingFor?.id !== result.id → ignored
  if (params.message.type === WorkflowEventType.Result && run?.waitingFor?.id !== params.message.result.id) {
    return 'ignored';
  }

  // Rule 5: Start with an existing run whose trigger is 'start' and no waitingFor → ignored
  if (params.message.type === WorkflowEventType.Start && run) {
    return 'ignored';
  }

  // Rule 6: Otherwise call handler with { runId, step: run?.step ?? 0, state: run?.state, event }
  // The result names the agent class, and the handler is typed by the key the workflow invoked it with.
  const request: Agent.WorkflowRequest<any> = {
    runId,
    step: run?.step ?? 0,
    state: run?.state,
    event: event.type === WorkflowEventType.Result && run?.waitingFor ? { ...event, agent: run.waitingFor.agent } : event
  };

  const nextStep = await params.handler(request);

  // Rule 7: next.complete → write { status: 'completed', outcome, reason, trigger: key, waitingFor: undefined } → completed
  if ('complete' in nextStep.next) {
    const completedRun: Agent.WorkflowRun<unknown> = {
      runId,
      status: WorkflowRunStatus.Completed,
      step: run?.step ?? 0,
      state: nextStep.state,
      outcome: nextStep.next.complete,
      reason: nextStep.next.reason,
      trigger: key,
      waitingFor: undefined,
      createdAt: run?.createdAt ?? params.now().toISOString(),
      updatedAt: params.now().toISOString()
    };
    const written = await params.store.write(completedRun, etag);
    if (!written) {
      throw new WorkflowConflictError(`Conflict writing completed workflow run "${runId}"`);
    }
    return 'completed';
  }

  // Rule 8: next.invoke with step + 1 > maxSteps → write { status: 'failed', reason: 'max_steps' } → failed
  const currentStep = run?.step ?? 0;
  const nextStepNumber = currentStep + 1;
  if (nextStepNumber > params.maxSteps) {
    const failedRun: Agent.WorkflowRun<unknown> = {
      runId,
      status: WorkflowRunStatus.Failed,
      step: currentStep,
      state: nextStep.state,
      reason: 'max_steps',
      trigger: key,
      waitingFor: undefined,
      createdAt: run?.createdAt ?? params.now().toISOString(),
      updatedAt: params.now().toISOString()
    };
    const written = await params.store.write(failedRun, etag);
    if (!written) {
      throw new WorkflowConflictError(`Conflict writing failed workflow run "${runId}"`);
    }
    return 'failed';
  }

  // Rule 9: next.invoke → id = newId(), write { status: 'running', step: step + 1, state, trigger: key, waitingFor: { agent, id, input, workspace } } FIRST, then invoke(...) with correlation JSON.stringify({ workflow, runId, step: step + 1 }) → started (from start) / advanced
  const invokeId = params.newId();
  const runningRun: Agent.WorkflowRun<unknown> = {
    runId,
    status: WorkflowRunStatus.Running,
    step: nextStepNumber,
    state: nextStep.state,
    trigger: key,
    waitingFor: {
      agent: nextStep.next.invoke,
      id: invokeId,
      input: nextStep.next.input,
      workspace: nextStep.next.workspace
    },
    createdAt: run?.createdAt ?? params.now().toISOString(),
    updatedAt: params.now().toISOString()
  };

  const written = await params.store.write(runningRun, etag);
  if (!written) {
    throw new WorkflowConflictError(`Conflict writing running workflow run "${runId}" for step ${nextStepNumber}`);
  }

  const correlation = JSON.stringify({
    workflow: params.workflow,
    runId,
    step: nextStepNumber
  });

  await params.invoke(nextStep.next.invoke, nextStep.next.input, {
    id: invokeId,
    correlation,
    workspace: nextStep.next.workspace
  });

  return params.message.type === WorkflowEventType.Start ? 'started' : 'advanced';
};
