import type { Agent, Service } from './contract';
import type { Result } from './result';
import type { WorkspaceRef } from './workspace';

export interface InvokeOptions {
  readonly correlation?: string;
  readonly id?: string;
  readonly workspace?: WorkspaceRef[];
}

export interface Client<S extends Service<any, any>> {
  invoke(input: Agent.InputOf<S>, options?: InvokeOptions): Promise<{ id: string }>;
  result(id: string): Promise<Result<S> | undefined>;
}
