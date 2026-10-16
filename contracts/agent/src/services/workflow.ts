import type { Service as CommonService } from '@ez4/common';
import type { Agent } from './contract';

export type WorkflowAgents = Record<string, Agent.Service<any, any>>;
export type AgentsOf<W> = W extends Workflow<any, any, infer A> ? A : never;
export type WorkflowInputOf<W> = W extends Workflow<infer I, any, any> ? I : never;
export type StateOf<W> = W extends Workflow<any, infer S, any> ? S : never;

/**
 * Type of workflow event being processed.
 */
export const enum WorkflowEventType {
  /**
   * Workflow execution start event.
   */
  Start = 'start',

  /**
   * Agent execution result event.
   */
  Result = 'result'
}

export type WorkflowEvent<I, A extends WorkflowAgents> =
  | { readonly type: WorkflowEventType.Start; readonly input: I }
  | {
      [K in keyof A & string]: { readonly type: WorkflowEventType.Result; readonly agent: K; readonly result: Agent.Result<A[K]> };
    }[keyof A & string];

export type WorkflowNext<A extends WorkflowAgents> =
  | {
      [K in keyof A & string]: { readonly invoke: K; readonly input: Agent.InputOf<A[K]>; readonly workspace?: Agent.WorkspaceRef[] };
    }[keyof A & string]
  | { readonly complete: string; readonly reason?: string };

export interface WorkflowStep<S, A extends WorkflowAgents> {
  readonly state: S;
  readonly next: WorkflowNext<A>;
}

export interface WorkflowRequest<W extends Workflow<any, any, any>> {
  readonly runId: string;
  readonly step: number;
  readonly state: StateOf<W> | undefined;
  readonly event: WorkflowEvent<WorkflowInputOf<W>, AgentsOf<W>>;
}
export type WorkflowHandler<W extends Workflow<any, any, any>> = (
  request: WorkflowRequest<W>,
  context: CommonService.Context<W>
) => Promise<WorkflowStep<any, any>> | WorkflowStep<any, any>;

/**
 * Execution status of a multi-agent workflow run.
 */
export const enum WorkflowRunStatus {
  /**
   * Workflow execution is in progress.
   */
  Running = 'running',

  /**
   * Workflow execution completed successfully.
   */
  Completed = 'completed',

  /**
   * Workflow execution failed.
   */
  Failed = 'failed'
}

export type WorkflowStatus = WorkflowRunStatus;

export interface WorkflowRun<S> {
  runId: string;
  status: WorkflowRunStatus;
  step: number;
  state?: S;
  outcome?: string;
  reason?: string;
  trigger: string;
  waitingFor?: { agent: string; id: string; input: unknown; workspace?: Agent.WorkspaceRef[] };
  createdAt: string;
  updatedAt: string;
}

export interface WorkflowClient<W extends Workflow<any, any, any>> {
  start(input: WorkflowInputOf<W>, options?: { runId?: string }): Promise<{ runId: string }>;
  status(runId: string): Promise<WorkflowRun<StateOf<W>> | undefined>;
}

export type Workflow<I extends Agent.Input, S, A extends WorkflowAgents = WorkflowAgents> = Agent.Workflow<I, S, A>;
