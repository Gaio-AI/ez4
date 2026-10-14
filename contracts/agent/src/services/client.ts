import type { Agent, Service } from './contract';
import type { Result } from './result';

export interface InvokeOptions {
  readonly correlation?: string;
}

export interface Client<S extends Service<any, any>> {
  invoke(input: Agent.InputOf<S>, options?: InvokeOptions): Promise<{ id: string }>;
  result(id: string): Promise<Result<S> | undefined>;
}
