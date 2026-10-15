import type { Agent } from '@ez4/agent';

export type LoginIO = {
  /** Runs a command inheriting terminal IO (for browser login). */
  run: (command: string, args: string[]) => Promise<number>;
  /** Prompts the user with masked input. */
  prompt: (question: string) => Promise<string>;
  /** Logs an informational message. */
  log: (message: string) => void;
};

export type ProviderAuth = {
  /** Container env var the provider SDK reads. */
  envName: string;
  /** Validates a credential before it is stored. */
  pattern: RegExp;
  /** Interactive login; resolves with the credential. */
  login: (io: LoginIO) => Promise<string>;
};

export const ProviderAuths: Record<Agent.ProviderName, ProviderAuth> = {
  claude: {
    envName: 'CLAUDE_CODE_OAUTH_TOKEN',
    pattern: /^sk-ant-oat01-[A-Za-z0-9_-]+$/,
    login: async (io: LoginIO): Promise<string> => {
      let exitCode: number;
      try {
        exitCode = await io.run('claude', ['setup-token']);
      } catch (error) {
        throw new Error(`Claude CLI setup-token failed: ${error instanceof Error ? error.message : String(error)}`);
      }
      if (exitCode !== 0) {
        throw new Error(`Claude CLI setup-token exited with code ${exitCode}`);
      }
      const answer = await io.prompt('Paste the token printed above, then press Enter on an empty line: ');
      // The token wraps across lines in the terminal; a paste keeps those breaks.
      const token = answer.replace(/\s+/g, '');
      if (!ProviderAuths.claude.pattern.test(token)) {
        throw new Error(`Invalid token format for claude: expected pattern ${ProviderAuths.claude.pattern}`);
      }
      return token;
    }
  }
};
