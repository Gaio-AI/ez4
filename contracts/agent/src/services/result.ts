import type { WorkspaceRef } from './workspace';

export type Status = 'succeeded' | 'failed' | 'timed_out';

export type ErrorCode = 'invalid_input' | 'invalid_output' | 'hook_error' | 'provider_error' | 'task_stopped' | 'timeout';

export interface Result<S = any> {
  id: string;
  agent: string;
  status: Status;
  output?: S extends { output: infer O } ? O : unknown;
  error?: {
    code: ErrorCode;
    message: string;
  };
  correlation?: string;
  workspace?: WorkspaceRef[];
  finishedAt: string;
}
