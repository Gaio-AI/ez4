import type { LinkedVariables } from '@ez4/project/library';
import type { Service as CommonService } from '@ez4/common';
import type { Status as ResultStatus, ErrorCode as ResultErrorCode, Result as AgentResult } from './result';
import type {
  Artifacts as HookArtifacts,
  PrepareRequest as HookPrepareRequest,
  PrepareResult as HookPrepareResult,
  FinishRequest as HookFinishRequest,
  FinishWorkspace as HookFinishWorkspace,
  PrepareHook as HookPrepareHook,
  FinishHook as HookFinishHook
} from './hooks';
import type { InvokeOptions as ClientInvokeOptions, Client as AgentClient } from './client';
import type {
  Workspace as AgentWorkspace,
  WorkspaceRepo as AgentWorkspaceRepo,
  WorkspaceAuth as AgentWorkspaceAuth,
  WorkspaceGithubApp as AgentWorkspaceGithubApp,
  WorkspaceRef as AgentWorkspaceRef,
  WorkspaceRequest as AgentWorkspaceRequest
} from './workspace';
import type {
  WorkflowAgents as AgentWorkflowAgents,
  AgentsOf as AgentAgentsOf,
  WorkflowInputOf as AgentWorkflowInputOf,
  StateOf as AgentStateOf,
  WorkflowEvent as AgentWorkflowEvent,
  WorkflowNext as AgentWorkflowNext,
  WorkflowStep as AgentWorkflowStep,
  WorkflowRequest as AgentWorkflowRequest,
  WorkflowHandler as AgentWorkflowHandler,
  WorkflowStatus as AgentWorkflowStatus,
  WorkflowRun as AgentWorkflowRun,
  WorkflowClient as AgentWorkflowClient
} from './workflow';
import type { AgentPermission } from './permissions';
import type { AgentProvider } from './provider';

/**
 * Operating mode for agent execution tools.
 */
export const enum AgentToolsMode {
  /**
   * Allow editing tools with bypassed permissions.
   */
  Edit = 'edit',

  /**
   * Restrict tools to read-only operations.
   */
  Readonly = 'readonly'
}

export interface LinkOptions extends Record<string, unknown> {
  readonly replyTo?: string;
}

export namespace Agent {
  export type ProviderName = AgentProvider;
  export type Status = ResultStatus;
  export type ErrorCode = ResultErrorCode;
  export type ToolsMode = AgentToolsMode;
  export type Workspace = AgentWorkspace;
  export type WorkspaceRepo = AgentWorkspaceRepo;
  export type WorkspaceAuth = AgentWorkspaceAuth;
  export type WorkspaceGithubApp = AgentWorkspaceGithubApp;
  export type WorkspaceRef = AgentWorkspaceRef;
  export type WorkspaceRequest = AgentWorkspaceRequest;
  export type WorkflowAgents = AgentWorkflowAgents;
  export type AgentsOf<W> = AgentAgentsOf<W>;
  export type WorkflowInputOf<W> = AgentWorkflowInputOf<W>;
  export type StateOf<W> = AgentStateOf<W>;
  export type WorkflowEvent<I, A extends WorkflowAgents> = AgentWorkflowEvent<I, A>;
  export type WorkflowNext<A extends WorkflowAgents> = AgentWorkflowNext<A>;
  export type WorkflowStep<S, A extends WorkflowAgents> = AgentWorkflowStep<S, A>;
  export type WorkflowRequest<W extends Workflow<any, any, any>> = AgentWorkflowRequest<W>;
  export type WorkflowHandler<W extends Workflow<any, any, any>> = AgentWorkflowHandler<W>;
  export type WorkflowStatus = AgentWorkflowStatus;
  export type WorkflowRun<S> = AgentWorkflowRun<S>;
  export type WorkflowClient<W extends Workflow<any, any, any>> = AgentWorkflowClient<W>;

  export interface Input {}
  export interface Output {}

  export interface Tools {
    readonly mode: AgentToolsMode;
    readonly allowed?: string[];
    readonly disallowed?: string[];
  }

  export type McpServer =
    | { readonly command: string; readonly args?: string[]; readonly env?: Record<string, string> }
    | { readonly url: string; readonly headers?: Record<string, string> };

  /**
   * Read access to AWS resources by name.
   */
  export interface Grant {
    readonly permission: AgentPermission;

    /**
     * Names of the resources (log groups, functions, clusters or stacks) it applies to, without the deploy prefix,
     * where `*` matches anything: `api-*` reads `stg-api-*` in a `stg` deploy and `prd-api-*` in a `prd` one.
     * `CodeArtifactRead` names account repositories as `<domain>/<repository>`, with no prefix.
     */
    readonly resources: string[];
  }

  /**
   * Allowed IAM actions on full resource ARNs.
   */
  export interface Statement {
    readonly actions: string[];
    readonly resources: string[];
  }

  export interface Permissions {
    readonly grants?: Grant[];
    readonly statements?: Statement[];
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
  export type FinishWorkspace = HookFinishWorkspace;

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
    readonly workspace?: Workspace;
    readonly prepare?: PrepareHook<I>;
    readonly finish?: FinishHook<I, O>;
    readonly image?: Image;
    readonly resources?: Resources;
    readonly permissions?: Permissions;
    /**
     * Domains the agent reaches besides the ones EZ4 allows on its own: the provider's (Claude login and API),
     * the workspace repository hosts and the AWS endpoints of its permissions.
     */
    readonly egress?: string[];
    readonly secrets?: Record<string, string>;
    readonly variables?: LinkedVariables;
    readonly services?: Record<string, unknown>;
    readonly tags?: CommonService.Tags;
    readonly client!: Client<this>;
    readonly options!: LinkOptions;
  }

  export abstract class Workflow<I extends Input, S, A extends WorkflowAgents = WorkflowAgents> implements CommonService.Provider {
    abstract readonly state: S;
    abstract readonly input: I;
    abstract readonly agents: A;
    abstract readonly handler: WorkflowHandler<Workflow<I, S, A>>;
    readonly maxSteps?: number;
    readonly variables?: LinkedVariables;
    readonly services?: Record<string, unknown>;
    readonly tags?: CommonService.Tags;
    readonly client!: WorkflowClient<this>;
  }
}

export type InputOf<S> = Agent.InputOf<S>;
export type OutputOf<S> = Agent.OutputOf<S>;
export type Service<I extends Agent.Input, O extends Agent.Output> = Agent.Service<I, O>;
export type Result<S extends Agent.Service<any, any>> = Agent.Result<S>;
