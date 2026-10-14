import type { LinkedVariables } from '@ez4/project/library';
import type { Service as CommonService } from '@ez4/common';
import type { Status as ResultStatus, ErrorCode as ResultErrorCode, Result as AgentResult } from './result';
import type {
  Artifacts as HookArtifacts,
  PrepareRequest as HookPrepareRequest,
  PrepareResult as HookPrepareResult,
  FinishRequest as HookFinishRequest,
  PrepareHook as HookPrepareHook,
  FinishHook as HookFinishHook
} from './hooks';
import type { InvokeOptions as ClientInvokeOptions, Client as AgentClient } from './client';

export interface LinkOptions extends Record<string, unknown> {
  readonly replyTo?: string;
}

export namespace Agent {
  export type ProviderName = 'claude';
  export type Preset = 'logs-read' | 'lambda-read' | 'ecs-read' | 'cloudformation-read';
  export type Status = ResultStatus;
  export type ErrorCode = ResultErrorCode;

  export interface Input {}
  export interface Output {}

  export interface Tools {
    readonly mode: 'edit' | 'readonly';
    readonly allowed?: string[];
    readonly disallowed?: string[];
  }

  export type McpServer =
    | { readonly command: string; readonly args?: string[]; readonly env?: Record<string, string> }
    | { readonly url: string; readonly headers?: Record<string, string> };

  export interface Statement {
    readonly effect?: 'allow' | 'deny';
    readonly actions: string[];
    readonly resources: string[];
  }

  export interface Permissions {
    readonly presets?: Preset[];
    readonly statements?: Statement[];
    readonly managedPolicies?: string[];
  }

  export interface Image {
    readonly base?: string;
    readonly aptPackages?: string[];
    readonly npmPackages?: string[];
  }

  export interface Resources {
    readonly cpu?: 256 | 512 | 1024 | 2048 | 4096 | 8192 | 16384;
    readonly memory?: number;
    readonly storage?: number;
    readonly timeout?: number;
  }

  export type Artifacts = HookArtifacts;
  export type PrepareRequest<I> = HookPrepareRequest<I>;
  export type PrepareResult = HookPrepareResult;
  export type FinishRequest<I, O> = HookFinishRequest<I, O>;

  export type PrepareHook<I = unknown> = HookPrepareHook<I>;
  export type FinishHook<I = unknown, O = unknown> = HookFinishHook<I, O>;

  export type Result<S extends Service<any, any>> = AgentResult<S>;
  export type InputOf<S> = S extends Service<infer I, any> ? I : never;
  export type OutputOf<S> = S extends Service<any, infer O> ? O : never;

  export type LinkOptions = {
    readonly replyTo?: string;
  };

  export type InvokeOptions = ClientInvokeOptions;
  export type Client<S extends Service<any, any>> = AgentClient<S>;

  export abstract class Service<I extends Input, O extends Output> implements CommonService.Provider {
    abstract readonly provider: ProviderName;
    abstract readonly model: string;
    abstract readonly instructions: string;
    abstract readonly input: I;
    abstract readonly output: O;
    readonly tools?: Tools;
    readonly mcpServers?: Record<string, McpServer>;
    readonly prepare?: PrepareHook<I>;
    readonly finish?: FinishHook<I, O>;
    readonly image?: Image;
    readonly resources?: Resources;
    readonly permissions?: Permissions;
    readonly egress?: string[];
    readonly secrets?: Record<string, string>;
    readonly variables?: LinkedVariables;
    readonly services?: Record<string, unknown>;
    readonly tags?: CommonService.Tags;
    readonly client!: Client<this>;
    readonly options!: LinkOptions;
  }
}

export type InputOf<S> = Agent.InputOf<S>;
export type OutputOf<S> = Agent.OutputOf<S>;
export type Service<I extends Agent.Input, O extends Agent.Output> = Agent.Service<I, O>;
export type Result<S extends Agent.Service<any, any>> = Agent.Result<S>;
