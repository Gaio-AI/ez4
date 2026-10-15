export type ImageBuildOptions = {
  agentName: string;
  repositoryUri: string;
  dockerfile: string;
  bundleHash: string;
  bundleFile: string;
  client?: EcrImageClient;
  commandRunner?: (command: string, args: string[], options?: { input?: string; cwd?: string }) => Promise<void>;
};

export type EcrImageClient = {
  imageExists(repositoryName: string, imageTag: string): Promise<boolean>;
  getAuthorizationToken(): Promise<{ authorizationToken?: string; proxyEndpoint?: string }>;
};
