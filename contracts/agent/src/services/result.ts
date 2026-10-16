import type { WorkspaceRef } from './workspace';

/**
 * Execution status of an agent invocation.
 */
export const enum AgentResultStatus {
  /**
   * Agent execution completed successfully.
   */
  Succeeded = 'succeeded',

  /**
   * Agent execution failed.
   */
  Failed = 'failed',

  /**
   * Agent execution timed out.
   */
  TimedOut = 'timed_out'
}

/**
 * Error code describing why an agent execution failed.
 */
export const enum AgentErrorCode {
  /**
   * Input schema validation failed.
   */
  InvalidInput = 'invalid_input',

  /**
   * Output schema validation failed.
   */
  InvalidOutput = 'invalid_output',

  /**
   * Prepare or finish hook execution failed.
   */
  HookError = 'hook_error',

  /**
   * LLM provider execution failed.
   */
  ProviderError = 'provider_error',

  /**
   * Task was stopped prematurely.
   */
  TaskStopped = 'task_stopped',

  /**
   * Agent execution exceeded its deadline.
   */
  Timeout = 'timeout'
}

export type Status = AgentResultStatus;
export type ErrorCode = AgentErrorCode;

export interface Result<S = any> {
  id: string;
  agent: string;
  status: AgentResultStatus;
  output?: S extends { output: infer O } ? O : unknown;
  error?: {
    code: AgentErrorCode;
    message: string;
  };
  correlation?: string;
  workspace?: WorkspaceRef[];
  finishedAt: string;
}
