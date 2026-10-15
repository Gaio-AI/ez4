export interface WorkspaceRepo {
  readonly url: string;
  readonly name?: string;
  readonly branch?: string;
}

export type WorkspaceAuth = { readonly githubApp: string } | { readonly token: string };

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
