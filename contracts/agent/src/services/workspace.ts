export interface WorkspaceRepo {
  readonly url: string;
  readonly name?: string;
  readonly branch?: string;
}

/**
 * GitHub App credentials. Usually bound to environment variables (`Environment.Variable<'NAME'>`);
 * the provider stores them in a secret it manages and never in the task definition.
 */
export interface WorkspaceGithubApp {
  readonly appId: string;
  readonly installationId: string;
  readonly privateKey: string;
}

export type WorkspaceAuth = { readonly githubApp: WorkspaceGithubApp } | { readonly token: string };

export interface Workspace {
  readonly repos: WorkspaceRepo[];
  readonly auth?: WorkspaceAuth;
}

export interface WorkspaceRef {
  readonly repo: string;
  readonly base: string;
  readonly head: string;
  readonly ref: string;
  readonly changed: boolean;
}

export interface WorkspaceRequest {
  readonly dir: string;
  readonly repos: Record<string, { readonly path: string; readonly base: string }>;
}
