import type { DeployOptions } from '@ez4/project/library';
import { describe, it } from 'node:test';
import { equal, deepEqual, ok } from 'node:assert/strict';
import { join } from 'node:path';

// The package bundler defines __MODULE_PATH; source imports in tests need it set.
const runtimeEnv = globalThis as { __MODULE_PATH?: string };
runtimeEnv.__MODULE_PATH = join(import.meta.dirname, '../dist');

import { buildProxyTaskDefinitionInput } from '../src/proxy/taskdef';
import { getAgentProxyUrl } from '../src/utils/names';
import { applyProxyEnvironment } from '../src/runtime/entry';

describe('proxy service and agent proxy environment', () => {
  it('assert :: builds proxy task definition input with correct family, secrets, port, and no password reference', () => {
    const result = buildProxyTaskDefinitionInput({
      baseName: 'ez4-lab-agents',
      squidConfig: 'http_port 3128\n',
      credentialSecretArns: ['arn:s:a', 'arn:s:b'],
      executionRoleArn: 'arn:r',
      logGroupName: '/g',
      region: 'us-east-1'
    });

    equal(result.family, 'ez4-lab-agents-proxy');

    const container = result.containerDefinitions?.[0];
    ok(container !== undefined);

    const secretValueFroms = container.secrets?.map((s) => s.valueFrom);
    deepEqual(secretValueFroms, ['arn:s:a:htpasswd::', 'arn:s:b:htpasswd::']);

    equal(container.portMappings?.[0]?.containerPort, 3128);

    ok(!JSON.stringify(container.secrets).includes('password'));
    ok(!JSON.stringify(result).includes(':password:'));
    ok(!/\bpassword\b/i.test(JSON.stringify(result)));
  });

  it('assert :: getAgentProxyUrl returns expected proxy url', () => {
    const url = getAgentProxyUrl({ prefix: 'ez4', projectName: 'lab' } as DeployOptions);
    equal(url, 'http://proxy.ez4-lab-agents.local:3128');
  });

  it('assert :: applyProxyEnvironment configures proxy variables and deletes password', () => {
    const env: Record<string, string | undefined> = {
      EZ4_AGENT_PROXY_URL: 'http://proxy.x.local:3128',
      EZ4_AGENT_PROXY_PASSWORD: 'p@ss',
      EZ4_AGENT_NAME: 'Echo'
    };

    applyProxyEnvironment(env, () => {});

    equal(env.HTTPS_PROXY, 'http://Echo:p%40ss@proxy.x.local:3128');
    equal(env.HTTP_PROXY, 'http://Echo:p%40ss@proxy.x.local:3128');
    equal(env.https_proxy, 'http://Echo:p%40ss@proxy.x.local:3128');
    equal(env.http_proxy, 'http://Echo:p%40ss@proxy.x.local:3128');
    equal(env.NODE_USE_ENV_PROXY, '1');
    equal(env.EZ4_AGENT_PROXY_PASSWORD, undefined);

    const envNoUrl: Record<string, string | undefined> = {
      EZ4_AGENT_PROXY_PASSWORD: 'p@ss',
      EZ4_AGENT_NAME: 'Echo'
    };

    applyProxyEnvironment(envNoUrl, () => {});
    equal(envNoUrl.HTTPS_PROXY, undefined);
  });

  it('assert :: applyProxyEnvironment turns the proxy on for this process after the variables are set', () => {
    const env: Record<string, string | undefined> = {
      EZ4_AGENT_PROXY_URL: 'http://proxy.x.local:3128',
      EZ4_AGENT_PROXY_PASSWORD: 'secret',
      EZ4_AGENT_NAME: 'Echo'
    };

    const seen: (string | undefined)[] = [];

    applyProxyEnvironment(env, () => seen.push(env.HTTPS_PROXY));

    deepEqual(seen, ['http://Echo:secret@proxy.x.local:3128']);
  });

  it('assert :: applyProxyEnvironment leaves this process alone when the proxy is not configured', () => {
    const seen: string[] = [];

    applyProxyEnvironment({ EZ4_AGENT_NAME: 'Echo' }, () => seen.push('activated'));

    deepEqual(seen, []);
  });
});
