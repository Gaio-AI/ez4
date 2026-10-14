import type { Service as CommonService } from '@ez4/common';
import type { InputOf, OutputOf, Service } from './contract';

export interface Artifacts {
  put(key: string, body: string | Uint8Array): Promise<void>;
  get(agent: string, id: string, key: string): Promise<Uint8Array | undefined>;
}

export interface PrepareRequest<I> {
  readonly id: string;
  readonly input: I;
  readonly workdir: string;
  readonly artifacts: Artifacts;
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
}

export type PrepareHook<S extends Service<any, any>> = (
  request: PrepareRequest<InputOf<S>>,
  context: CommonService.Context<S>
) => Promise<PrepareResult> | PrepareResult;

export type FinishHook<S extends Service<any, any>> = (
  request: FinishRequest<InputOf<S>, OutputOf<S>>,
  context: CommonService.Context<S>
) => Promise<OutputOf<S>> | OutputOf<S>;
