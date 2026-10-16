import type { Service as CommonService } from '@ez4/common';
import type { WorkspaceRef, WorkspaceRequest } from './workspace';

export interface Artifacts {
  put(key: string, body: string | Uint8Array): Promise<void>;
  get(agent: string, id: string, key: string): Promise<Uint8Array | undefined>;
}

export interface PrepareRequest<I> {
  readonly id: string;
  readonly input: I;
  readonly workdir: string;
  readonly artifacts: Artifacts;
  readonly workspace?: WorkspaceRequest;
}

export interface PrepareResult {
  readonly prompt: string;
  readonly workdir?: string;
}

export interface FinishRequest<I, O> {
  readonly id: string;
  readonly input: I;
  readonly output: O;
  readonly workdir: string;
  readonly artifacts: Artifacts;
  readonly workspace?: WorkspaceRequest & { readonly refs: WorkspaceRef[] };
}

// Like other ez4 handlers, a hook types its context with `Service.Context<TheAgent>`.
export type PrepareHook<I = unknown> = (request: PrepareRequest<I>, context: CommonService.Context<any>) => Promise<PrepareResult> | PrepareResult;

export type FinishHook<I = unknown, O = unknown> = (request: FinishRequest<I, O>, context: CommonService.Context<any>) => Promise<O> | O;
