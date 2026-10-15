import type { Agent } from '@ez4/agent';
import type { ResourceTags } from '@ez4/aws-common';
import type { LoginIO } from './providers';

import { spawn } from 'node:child_process';
import * as readline from 'node:readline';
import { Writable } from 'node:stream';

import { findProviderSecret, storeProviderSecret } from './client';
import { ProviderAuths } from './providers';

export class ProviderLoginRequiredError extends Error {
  constructor(
    public readonly secretName: string,
    public readonly envName: string
  ) {
    super(`Secret "${secretName}" (key "${envName}") is missing. Run the deploy from an interactive terminal to log in, or create the secret with that key.`);
    this.name = 'ProviderLoginRequiredError';
  }
}

export type CredentialPorts = {
  find: (secretName: string) => Promise<{ secretArn: string } | undefined>;
  store: (secretName: string, value: Record<string, string>, tags?: ResourceTags) => Promise<{ secretArn: string }>;
  interactive: () => boolean;
  io: LoginIO;
  force: () => boolean;
};

export const defaultLoginIO: LoginIO = {
  run: (command: string, args: string[]): Promise<number> => {
    const { promise, resolve, reject } = Promise.withResolvers<number>();
    const child = spawn(command, args, { stdio: 'inherit' });
    child.on('error', reject);
    child.on('close', (code, signal) => resolve(signal ? 1 : (code ?? 1)));
    return promise;
  },
  prompt: (question: string): Promise<string> => {
    const { promise, resolve } = Promise.withResolvers<string>();
    let muted = false;
    const mutableStdout = new Writable({
      write(chunk, encoding, callback) {
        if (!muted) {
          process.stdout.write(chunk, encoding);
        }
        callback();
      }
    });
    const rl = readline.createInterface({
      input: process.stdin,
      output: mutableStdout,
      terminal: true
    });
    rl.question(question, (answer) => {
      rl.close();
      process.stdout.write('\n');
      resolve(answer);
    });
    muted = true;
    return promise;
  },
  log: (message: string) => {
    console.log(message);
  }
};
export const getDefaultCredentialPorts = (): CredentialPorts => ({
  find: (secretName) => findProviderSecret(secretName),
  store: (secretName, value, tags) => storeProviderSecret(secretName, value, tags),
  interactive: () => !!process.stdin.isTTY && !!process.stdout.isTTY && process.env.CI !== 'true',
  force: () => process.env.EZ4_AGENT_LOGIN === 'force',
  io: defaultLoginIO
});

const credentialMemo = new Map<string, Promise<{ secretArn: string }>>();

export const resetProviderCredentialCache = () => {
  credentialMemo.clear();
};

export const ensureProviderCredential = async (
  provider: Agent.ProviderName,
  secretName: string,
  ports: CredentialPorts,
  tags?: ResourceTags
): Promise<{ secretArn: string }> => {
  const cached = credentialMemo.get(secretName);
  if (cached) {
    return cached;
  }

  const promise = (async () => {
    const auth = ProviderAuths[provider];
    if (!auth) {
      throw new Error(`Unsupported agent provider: ${provider}`);
    }

    const force = ports.force();
    if (!force) {
      const existing = await ports.find(secretName);
      if (existing) {
        return existing;
      }
    }

    if (!ports.interactive()) {
      throw new ProviderLoginRequiredError(secretName, auth.envName);
    }

    const token = await auth.login(ports.io);
    return ports.store(secretName, { [auth.envName]: token }, tags);
  })().catch((error) => {
    credentialMemo.delete(secretName);
    throw error;
  });

  credentialMemo.set(secretName, promise);
  return promise;
};
