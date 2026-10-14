import type { EntryStates, StepContext, StepOptions } from '@ez4/state';
import type { AgentDomainInput } from '../src/proxy/config';
import type { ProxyCredentialResult, ProxyCredentialState } from '../src/proxy/types';

import { describe, it } from 'node:test';
import { equal, ok, throws } from 'node:assert/strict';

import {
  SecretsManagerClient,
  CreateSecretCommand,
  DescribeSecretCommand,
  DeleteSecretCommand,
  ResourceNotFoundException
} from '@aws-sdk/client-secrets-manager';

import {
  generateSquidConfig,
  resolveAgentAllowedDomains,
  buildNoProxyList,
  normalizeDomain,
  getAgentEgressDomains
} from '../src/proxy/config';
import { generateHtpasswd, generateAgentPassword } from '../src/proxy/auth';
import { createProxyCredential, getProxyCredentialHandler } from '../src/proxy/credential';
import { setSecretsManagerClient } from '../src/proxy/client';
import { ProxyCredentialServiceType } from '../src/proxy/types';

describe('proxy :: configuration and auth', () => {
  it('generates squid.conf with authentication and allowlists per agent user', () => {
    const config = generateSquidConfig({
      port: 3128,
      agents: [
        {
          agentName: 'coder',
          allowedDomains: ['github.com', 'api.github.com', 'registry.npmjs.org', '.npmjs.org']
        },
        {
          agentName: 'reviewer',
          allowedDomains: ['api.github.com']
        }
      ]
    });

    ok(config.includes('http_port 3128'));
    ok(config.includes('auth_param basic program /usr/lib/squid/basic_ncsa_auth /etc/squid/passwords'));
    ok(config.includes('acl auth_users proxy_auth REQUIRED'));
    ok(config.includes('acl user_coder proxy_auth coder'));
    ok(config.includes('acl user_reviewer proxy_auth reviewer'));
    ok(config.includes('acl domains_coder dstdomain github.com api.github.com registry.npmjs.org .npmjs.org'));
    ok(config.includes('acl domains_reviewer dstdomain api.github.com'));
    ok(config.includes('http_access allow user_coder domains_coder'));
    ok(config.includes('http_access allow user_reviewer domains_reviewer'));
    ok(config.includes('http_access deny all'));
  });

  it('normalizes wildcard domains to .suffix and handles exact domains', () => {
    equal(normalizeDomain('example.com'), 'example.com');
    equal(normalizeDomain('*.example.com'), '.example.com');
    equal(normalizeDomain('.example.com'), '.example.com');
    throws(() => normalizeDomain('https://example.com'), /protocol/);
    throws(() => normalizeDomain('example.com/path'), /Invalid/);
  });

  it('resolves agent domains combining declared domains and AWS endpoints from presets', () => {
    const input: AgentDomainInput = {
      domains: ['api.linear.app'],
      presets: ['logs-read', 'ecs-read']
    };
    const domains = resolveAgentAllowedDomains(input, 'us-east-1');

    ok(domains.includes('api.linear.app'));
    ok(domains.includes('logs.us-east-1.amazonaws.com'));
    ok(domains.includes('ecs.us-east-1.amazonaws.com'));
  });

  it('resolves agent domains from statements action prefixes as <service>.<region>.amazonaws.com', () => {
    const input: AgentDomainInput = {
      egress: ['github.com'],
      statements: [
        {
          actions: ['sts:AssumeRole', 'sts:GetCallerIdentity'],
          resources: ['*']
        },
        {
          actions: ['lambda:InvokeFunction'],
          resources: ['*']
        },
        {
          actions: ['cloudformation:DescribeStacks'],
          resources: ['*']
        }
      ]
    };
    const domains = resolveAgentAllowedDomains(input, 'us-east-1');

    ok(domains.includes('github.com'));
    ok(domains.includes('sts.us-east-1.amazonaws.com'));
    ok(domains.includes('lambda.us-east-1.amazonaws.com'));
    ok(domains.includes('cloudformation.us-east-1.amazonaws.com'));
  });

  it('builds standard NO_PROXY list for AWS VPC endpoints', () => {
    const noProxy = buildNoProxyList('us-east-1');
    ok(noProxy.includes('169.254.169.254'));
    ok(noProxy.includes('169.254.170.2'));
    ok(noProxy.includes('s3.us-east-1.amazonaws.com'));
    ok(noProxy.includes('.s3.us-east-1.amazonaws.com'));
    ok(noProxy.includes('logs.us-east-1.amazonaws.com'));
    ok(noProxy.includes('secretsmanager.us-east-1.amazonaws.com'));
    ok(noProxy.includes('api.ecr.us-east-1.amazonaws.com'));
    ok(noProxy.includes('dkr.ecr.us-east-1.amazonaws.com'));
    ok(noProxy.includes('dynamodb.us-east-1.amazonaws.com'));
    ok(noProxy.includes('.us-east-1.vpce.amazonaws.com'));
    ok(noProxy.includes('127.0.0.1'));
    ok(noProxy.includes('localhost'));
  });

  it('generates htpasswd entries without storing raw passwords in configuration', () => {
    const password = generateAgentPassword();
    equal(password.length >= 32, true);

    const htpasswd = generateHtpasswd({
      'test-agent': password
    });
    ok(htpasswd.startsWith('test-agent:'));
    ok(!htpasswd.includes(password)); // Must be hashed!
    ok(htpasswd.includes('{SHA}'));
  });

  it('handles proxy credential secret StepHandler without leaking password to state', async () => {
    const state: EntryStates = {};
    const credentialState = createProxyCredential(state, {
      secretName: 'ez4-test-coder-proxy',
      agentName: 'coder',
      tags: { project: 'test' }
    });

    equal(credentialState.type, ProxyCredentialServiceType);
    equal(credentialState.parameters.secretName, 'ez4-test-coder-proxy');
    equal(credentialState.parameters.agentName, 'coder');
    // Ensure no password exists on parameters
    ok(!('password' in (credentialState.parameters as Record<string, unknown>)));

    interface SecretCreatedPayload {
      Name?: string;
      SecretString?: string;
    }
    let secretCreatedPayload: SecretCreatedPayload | null = null;
    let secretDeletedId: string | null = null;

    const mockClient = {
      send: async (command: unknown) => {
        if (command instanceof DescribeSecretCommand) {
          throw new ResourceNotFoundException({
            message: 'Secret not found',
            $metadata: {}
          });
        }
        if (command instanceof CreateSecretCommand) {
          secretCreatedPayload = {
            Name: command.input.Name,
            SecretString: command.input.SecretString
          };
          return {
            Name: command.input.Name,
            ARN: `arn:aws:secretsmanager:us-east-1:123:secret:${command.input.Name}-xyz`
          };
        }
        if (command instanceof DeleteSecretCommand) {
          secretDeletedId = command.input.SecretId ?? null;
          return {};
        }
        throw new Error('Unknown command');
      }
    } as unknown as SecretsManagerClient;

    setSecretsManagerClient(mockClient);

    const mockContext = {} as StepContext;
    const handler = getProxyCredentialHandler();
    const result = (await handler.create(credentialState, mockContext)) as ProxyCredentialResult;

    ok(result !== undefined);
    equal(result.secretName, 'ez4-test-coder-proxy');
    equal(result.agentName, 'coder');
    ok(result.secretArn.includes('ez4-test-coder-proxy'));
    // Ensure no password in result
    ok(!('password' in (result as Record<string, unknown>)));

    // Ensure password was generated and passed to Secrets Manager
    ok(secretCreatedPayload !== null);
    const createdPayload: SecretCreatedPayload = secretCreatedPayload;
    ok(createdPayload.SecretString !== undefined);
    const parsedSecret = JSON.parse(createdPayload.SecretString) as { username: string; password: string };
    equal(parsedSecret.username, 'coder');
    equal(typeof parsedSecret.password, 'string');
    equal(parsedSecret.password.length >= 32, true);

    // Test handler.equals
    const candidateState: ProxyCredentialState = {
      ...credentialState,
      result
    };
    equal(await handler.equals(candidateState, candidateState), true);

    // Test handler.preview
    const options = {} as StepOptions;
    const preview = await handler.preview(
      {
        ...candidateState,
        parameters: { ...candidateState.parameters, tags: { updated: 'true' } }
      },
      candidateState,
      options
    );
    ok(preview !== undefined);
    equal(preview.counts, 1);

    // Test handler.delete
    const deleteContext = {
      force: true
    } as StepContext;
    await handler.delete(candidateState, deleteContext);
    equal(secretDeletedId, 'ez4-test-coder-proxy');

    setSecretsManagerClient(null);
  });
  it('resolves agent egress domains including provider domains', () => {
    const domains = getAgentEgressDomains(
      {
        provider: 'claude',
        egress: ['github.com']
      },
      'us-east-1'
    );
    ok(domains.includes('api.anthropic.com'));
    ok(domains.includes('github.com'));
  });

  it('skips agents with empty allowedDomains in generateSquidConfig', () => {
    const config = generateSquidConfig({
      agents: [
        {
          agentName: 'empty-agent',
          allowedDomains: []
        }
      ]
    });
    ok(!config.includes('acl domains_empty-agent'));
    ok(!config.includes('user_empty-agent'));
  });
});
