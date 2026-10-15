import type { DeployOptions, EventContext, PrepareResourceEvent, ServiceMetadata } from '@ez4/project/library';
import type { EntryState, EntryStates, StepContext } from '@ez4/state';
import type { AgentService } from '@ez4/agent/library';
import type { EcsTaskDefState } from '@ez4/aws-ecs';

import { describe, it, beforeEach } from 'node:test';
import { equal, deepEqual, rejects, ok } from 'node:assert/strict';
import { join } from 'node:path';

// The package bundler defines __MODULE_PATH; source imports in tests need it set.
(globalThis as { __MODULE_PATH?: string }).__MODULE_PATH = join(import.meta.dirname, '../dist');

import { createAgentService } from '@ez4/agent/library';
import {
  ensureProviderCredential,
  ProviderLoginRequiredError,
  resetProviderCredentialCache,
  defaultLoginIO,
  type CredentialPorts
} from '../src/auth/login';
import { SecretServiceType, type SecretState } from '@ez4/aws-secret';
import { prepareAgentResources } from '../src/triggers/resources';
import { buildTaskDefinitionInput } from '../src/agent/taskdef';

const options: DeployOptions = { prefix: 'ez4', projectName: 'lab', branchName: '', lockId: 'x' } as DeployOptions;

const makeContext = (): EventContext => {
  const states = new Map<string, EntryState>();
  return {
    getServiceState: (service: ServiceMetadata | string, opt: DeployOptions) => {
      const name = typeof service === 'string' ? service : service.name;
      return states.get(`${opt.projectName}:${name}`);
    },
    setServiceState: (service: ServiceMetadata | string, opt: DeployOptions, state: EntryState) => {
      const name = typeof service === 'string' ? service : service.name;
      states.set(`${opt.projectName}:${name}`, state);
    }
  } as unknown as EventContext;
};

const isSecretState = (entry: EntryState | undefined): entry is SecretState => {
  return entry?.type === SecretServiceType;
};
const baseNetwork = {
  getDefaultVpcId: async () => 'vpc-1',
  getTaggedSubnetIds: async () => ['subnet-a', 'subnet-b'],
  getTaggedSecurityGroupIds: async (_vpc: string, tag: { key: string }) => (tag.key === 'ez4:agents-proxy' ? ['sg-proxy'] : ['sg-agents'])
};

describe('provider login stored per stage and reused', () => {
  beforeEach(() => {
    resetProviderCredentialCache();
  });

  it('assert :: secret exists -> returns ARN, io.run never called', async () => {
    let runCalled = false;
    const ports: CredentialPorts = {
      find: async (secretName) => {
        equal(secretName, 'ez4/agents/claude');
        return { secretArn: 'arn:aws:secretsmanager:us-east-1:123:secret:ez4/agents/claude-AbCdEf' };
      },
      store: async () => {
        throw new Error('store should not be called');
      },
      interactive: () => false,
      force: () => false,
      io: {
        run: async () => {
          runCalled = true;
          return 0;
        },
        prompt: async () => 'token',
        log: () => {}
      }
    };

    const result = await ensureProviderCredential('claude', 'ez4/agents/claude', ports);
    equal(result.secretArn, 'arn:aws:secretsmanager:us-east-1:123:secret:ez4/agents/claude-AbCdEf');
    equal(runCalled, false);
  });

  it('assert :: missing + interactive -> run("claude", ["setup-token"]) once, prompt answer stored', async () => {
    let runArgs: { command: string; args: string[] } | undefined;
    let storedSecret: { name: string; value: Record<string, string> } | undefined;

    const ports: CredentialPorts = {
      find: async () => undefined,
      store: async (secretName, value) => {
        storedSecret = { name: secretName, value };
        return { secretArn: 'arn:aws:secretsmanager:us-east-1:123:secret:ez4/agents/claude-New123' };
      },
      interactive: () => true,
      force: () => false,
      io: {
        run: async (command, args) => {
          runArgs = { command, args };
          return 0;
        },
        prompt: async () => 'sk-ant-oat01-abc123456789',
        log: () => {}
      }
    };

    const result = await ensureProviderCredential('claude', 'ez4/agents/claude', ports);
    equal(result.secretArn, 'arn:aws:secretsmanager:us-east-1:123:secret:ez4/agents/claude-New123');
    deepEqual(runArgs, { command: 'claude', args: ['setup-token'] });
    deepEqual(storedSecret, {
      name: 'ez4/agents/claude',
      value: { CLAUDE_CODE_OAUTH_TOKEN: 'sk-ant-oat01-abc123456789' }
    });
  });

  it('assert :: missing + non-interactive -> rejects with ProviderLoginRequiredError naming secret & envName', async () => {
    const ports: CredentialPorts = {
      find: async () => undefined,
      store: async () => {
        throw new Error('store should not be called');
      },
      interactive: () => false,
      force: () => false,
      io: {
        run: async () => 0,
        prompt: async () => '',
        log: () => {}
      }
    };

    await rejects(ensureProviderCredential('claude', 'ez4/agents/claude', ports), (err: Error) => {
      ok(err instanceof ProviderLoginRequiredError);
      equal(err.secretName, 'ez4/agents/claude');
      equal(err.envName, 'CLAUDE_CODE_OAUTH_TOKEN');
      equal(
        err.message,
        'Secret "ez4/agents/claude" (key "CLAUDE_CODE_OAUTH_TOKEN") is missing. Run the deploy from an interactive terminal to log in, or create the secret with that key.'
      );
      return true;
    });
  });

  it('assert :: default login runner treats signal termination and missing exit code as failure', async () => {
    equal(await defaultLoginIO.run(process.execPath, ['-e', 'process.exit(0)']), 0);
    equal(await defaultLoginIO.run(process.execPath, ['-e', 'process.exit(3)']), 3);
    equal(await defaultLoginIO.run(process.execPath, ['-e', 'process.kill(process.pid, "SIGTERM")']), 1);
  });

  it('assert :: invalid pasted token -> rejects, nothing stored', async () => {
    let storeCalled = false;
    const ports: CredentialPorts = {
      find: async () => undefined,
      store: async () => {
        storeCalled = true;
        return { secretArn: 'arn:aws:secretsmanager:...' };
      },
      interactive: () => true,
      force: () => false,
      io: {
        run: async () => 0,
        prompt: async () => 'invalid-token-without-prefix',
        log: () => {}
      }
    };

    await rejects(ensureProviderCredential('claude', 'ez4/agents/claude', ports), /Invalid token format for claude/);
    equal(storeCalled, false);
  });

  it('assert :: two agents in one prepare -> one login, one state entry, both taskdefs depend on it', async () => {
    const state: EntryStates = {};
    const context = makeContext();
    let loginRuns = 0;
    let storeCalls = 0;

    const ports = {
      network: baseNetwork,
      bundle: async () => ({ file: '/tmp/agent.mjs', hash: 'agent-hash' }),
      identity: async () => ({ region: 'us-east-1', accountId: '123456789012' }),
      dispatcherBundle: async () => '/tmp/dispatcher.mjs',
      credential: {
        find: async () => undefined,
        store: async (_secretName: string, _value: Record<string, string>) => {
          storeCalls++;
          return { secretArn: 'arn:aws:secretsmanager:us-east-1:123456789012:secret:ez4/agents/claude-XyZ' };
        },
        interactive: () => true,
        force: () => false,
        io: {
          run: async () => {
            loginRuns++;
            return 0;
          },
          prompt: async () => 'sk-ant-oat01-sharedtoken123',
          log: () => {}
        }
      }
    };

    const first: AgentService = { ...createAgentService('AgentOne'), provider: 'claude', model: 'claude-3-7-sonnet', instructions: 'i' };
    const second: AgentService = { ...createAgentService('AgentTwo'), provider: 'claude', model: 'claude-3-7-sonnet', instructions: 'i' };
    const metadata = { AgentOne: first, AgentTwo: second };

    for (const service of [first, second]) {
      const event = { state, service, metadata, options, context } as PrepareResourceEvent;
      equal(await prepareAgentResources(event, ports), true);
    }

    equal(loginRuns, 1);
    equal(storeCalls, 1);

    const providerCreds = Object.values(state).filter(
      (entry): entry is SecretState => isSecretState(entry) && entry.parameters.secretName === 'ez4/agents/claude'
    );
    equal(providerCreds.length, 1);
    const providerCredEntryId = providerCreds[0]!.entryId;

    const taskdefOne = context.getServiceState('AgentOne', options);
    const taskdefTwo = context.getServiceState('AgentTwo', options);
    ok(taskdefOne.dependencies.includes(providerCredEntryId));
    ok(taskdefTwo.dependencies.includes(providerCredEntryId));
  });

  it('assert :: agent declaring secrets.CLAUDE_CODE_OAUTH_TOKEN -> no login, own secret kept', async () => {
    const state: EntryStates = {};
    const context = makeContext();
    let findCalled = false;
    let storeCalled = false;

    const ports = {
      network: baseNetwork,
      bundle: async () => ({ file: '/tmp/agent.mjs', hash: 'agent-hash' }),
      identity: async () => ({ region: 'us-east-1', accountId: '123456789012' }),
      dispatcherBundle: async () => '/tmp/dispatcher.mjs',
      credential: {
        find: async () => {
          findCalled = true;
          return undefined;
        },
        store: async () => {
          storeCalled = true;
          return { secretArn: 'arn:...' };
        },
        interactive: () => false,
        force: () => false,
        io: {
          run: async () => 0,
          prompt: async () => '',
          log: () => {}
        }
      }
    };

    const agent: AgentService = {
      ...createAgentService('CustomSecretAgent'),
      provider: 'claude',
      model: 'claude-3-7-sonnet',
      instructions: 'i',
      secrets: {
        CLAUDE_CODE_OAUTH_TOKEN: 'my-custom-oauth-token-secret'
      }
    };

    const event = { state, service: agent, metadata: { CustomSecretAgent: agent }, options, context } as PrepareResourceEvent;
    equal(await prepareAgentResources(event, ports), true);

    equal(findCalled, false);
    equal(storeCalled, false);

    const providerCreds = Object.values(state).filter(
      (entry): entry is SecretState => isSecretState(entry) && entry.parameters.secretName === 'ez4/agents/claude'
    );
    equal(providerCreds.length, 0);

    const taskdef = context.getServiceState('CustomSecretAgent', options) as EcsTaskDefState;
    const taskInput = taskdef.parameters.getTaskDefinition({ getDependencies: () => [] } as unknown as StepContext);
    const secret = taskInput.containerDefinitions?.[0]?.secrets?.find((s) => s.name === 'CLAUDE_CODE_OAUTH_TOKEN');
    equal(secret?.valueFrom, 'arn:aws:secretsmanager:us-east-1::secret:my-custom-oauth-token-secret');
  });

  it('assert :: force with existing secret -> login runs and store called', async () => {
    let runCalled = false;
    let storeCalled = false;

    const ports: CredentialPorts = {
      find: async () => ({ secretArn: 'arn:aws:secretsmanager:us-east-1:123:secret:ez4/agents/claude-Existing' }),
      store: async (secretName, value) => {
        storeCalled = true;
        equal(secretName, 'ez4/agents/claude');
        equal(value['CLAUDE_CODE_OAUTH_TOKEN'], 'sk-ant-oat01-forced');
        return { secretArn: 'arn:aws:secretsmanager:us-east-1:123:secret:ez4/agents/claude-Existing' };
      },
      interactive: () => true,
      force: () => true,
      io: {
        run: async () => {
          runCalled = true;
          return 0;
        },
        prompt: async () => 'sk-ant-oat01-forced',
        log: () => {}
      }
    };

    const result = await ensureProviderCredential('claude', 'ez4/agents/claude', ports);
    equal(runCalled, true);
    equal(storeCalled, true);
    equal(result.secretArn, 'arn:aws:secretsmanager:us-east-1:123:secret:ez4/agents/claude-Existing');
  });

  it('assert :: taskdef credential dependency -> container secret CLAUDE_CODE_OAUTH_TOKEN with valueFrom <arn>:CLAUDE_CODE_OAUTH_TOKEN::', async () => {
    const taskDef = buildTaskDefinitionInput(
      {
        ...createAgentService('EchoAgent'),
        resources: { cpu: 256, memory: 512 }
      },
      '123456789012.dkr.ecr.us-east-1.amazonaws.com/ez4-stg-echo:latest',
      'arn:aws:iam::123456789012:role/task-role',
      'arn:aws:iam::123456789012:role/exec-role',
      'arn:aws:logs:us-east-1:123456789012:log-group:/ez4/agents/echo',
      {
        baseName: 'ez4-stg-agents',
        bucketName: 'ez4-stg-agents-bucket',
        region: 'us-east-1',
        providerSecrets: [
          {
            name: 'CLAUDE_CODE_OAUTH_TOKEN',
            secretArn: 'arn:aws:secretsmanager:us-east-1:123456789012:secret:ez4/agents/claude-AbCdEf'
          }
        ]
      }
    );

    const container = taskDef.containerDefinitions?.[0];
    ok(container);
    const secretMap = Object.fromEntries((container.secrets ?? []).map((s) => [s.name, s.valueFrom]));
    equal(
      secretMap['CLAUDE_CODE_OAUTH_TOKEN'],
      'arn:aws:secretsmanager:us-east-1:123456789012:secret:ez4/agents/claude-AbCdEf:CLAUDE_CODE_OAUTH_TOKEN::'
    );
  });
});
