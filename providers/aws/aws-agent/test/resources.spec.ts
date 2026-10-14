import type { DeployOptions, EventContext, PrepareResourceEvent } from '@ez4/project/library';
import type { EntryState, EntryStates } from '@ez4/state';

import { describe, it } from 'node:test';
import { equal, ok, deepEqual } from 'node:assert/strict';

import { join } from 'node:path';

// The package bundler defines __MODULE_PATH; source imports in tests need it set.
(globalThis as { __MODULE_PATH?: string }).__MODULE_PATH = join(import.meta.dirname, '../dist');
import { createAgentService } from '@ez4/agent/library';
import { createCronService } from '@ez4/scheduler/library';
import { RoleServiceType } from '@ez4/aws-identity';
import { BucketServiceType } from '@ez4/aws-bucket';
import { LogGroupServiceType } from '@ez4/aws-logs';
import { FunctionServiceType } from '@ez4/aws-function';
import { EventsRuleServiceType } from '../src/events/types';

import { prepareAgentResources } from '../src/triggers/resources';
import { getAgentBucketName, getAgentClusterName, getAgentKey } from '../src/utils/names';
import { EcrImageServiceType } from '../src/image/state';
import { EcrRepositoryServiceType } from '../src/image/types';
import { EcsClusterServiceType } from '../src/cluster/types';
import { EcsTaskDefServiceType } from '../src/taskdef/types';

const options: DeployOptions = { prefix: 'ez4', projectName: 'lab', branchName: '', lockId: 'x' } as DeployOptions;

const makeContext = (): EventContext => {
  const states = new Map<string, EntryState>();
  return {
    role: null,
    setServiceState: (service, _options, state) => void states.set(typeof service === 'string' ? service : service.name, state),
    getServiceState: (service) => states.get(typeof service === 'string' ? service : service.name)!,
    setVirtualServiceState: () => undefined,
    getVirtualServiceState: () => undefined,
    getDependencyFiles: () => []
  };
};

const ports = {
  network: {
    getDefaultVpcId: async () => 'vpc-1',
    getTaggedSubnetIds: async () => ['subnet-a', 'subnet-b'],
    getTaggedSecurityGroupIds: async () => ['sg-agents']
  },
  bundle: async () => ({ file: '/tmp/echo.mjs', hash: 'bundlehash' }),
  identity: async () => ({ region: 'us-east-1', accountId: '123456789012' }),
  dispatcherBundle: async () => '/tmp/dispatcher.mjs'
};

const countType = (state: EntryStates, type: string) => Object.values(state).filter((entry) => entry?.type === type).length;

describe('agent resources wiring', () => {
  it('assert :: one cluster, bucket and execution role per project; per-agent entries', async () => {
    const state: EntryStates = {};
    const context = makeContext();
    const first = { ...createAgentService('EchoAgent'), provider: 'claude', model: 'm', instructions: 'i' } as never;
    const second = { ...createAgentService('ReviewAgent'), provider: 'claude', model: 'm', instructions: 'i' } as never;

    for (const service of [first, second]) {
      const event = { state, service, metadata: {}, options, context } as PrepareResourceEvent;
      equal(await prepareAgentResources(event, ports), true);
    }

    equal(countType(state, EcsClusterServiceType), 1);
    equal(countType(state, BucketServiceType), 1);
    equal(countType(state, EcrRepositoryServiceType), 2);
    equal(countType(state, EcrImageServiceType), 2);
    equal(countType(state, EcsTaskDefServiceType), 2);
    // 2 agent log groups + 1 dispatcher log group
    equal(countType(state, LogGroupServiceType), 3);
    // 2 task roles + 1 shared execution role + 1 dispatcher role
    equal(countType(state, RoleServiceType), 4);

    const bucket = Object.values(state).find((entry) => entry?.type === BucketServiceType)!;
    equal((bucket.parameters as { bucketName: string }).bucketName, getAgentBucketName(options));
    ok(getAgentBucketName(options).startsWith('ez4-lab-agents-'));
    equal(getAgentClusterName(options), 'ez4-lab-agents');

    const taskdef = context.getServiceState('EchoAgent', options);
    equal(taskdef.type, EcsTaskDefServiceType);
    const dependencyTypes = taskdef.dependencies.map((id) => state[id]!.type).sort();
    deepEqual(dependencyTypes, [EcrImageServiceType, LogGroupServiceType, RoleServiceType, RoleServiceType].sort());
  });

  it('assert :: non-agent services are ignored', async () => {
    const state: EntryStates = {};
    const service = createCronService('Tick');
    const event = { state, service, metadata: {}, options, context: makeContext() } as PrepareResourceEvent;
    equal(await prepareAgentResources(event, ports), false);
    equal(Object.keys(state).length, 0);
  });

  it('assert :: bucket keys use the agent name verbatim', () => {
    equal(getAgentKey({ ...createAgentService('EchoAgent') } as never), 'EchoAgent');
  });
  it('assert :: prepareAgentResources creates dispatcher function and events rules once', async () => {
    const state: EntryStates = {};
    const context = makeContext();
    const first = { ...createAgentService('EchoAgent'), provider: 'claude', model: 'm', instructions: 'i' } as never;
    const second = { ...createAgentService('ReviewAgent'), provider: 'claude', model: 'm', instructions: 'i' } as never;

    for (const service of [first, second]) {
      const event = { state, service, metadata: {}, options, context } as PrepareResourceEvent;
      equal(await prepareAgentResources(event, ports), true);
    }

    equal(countType(state, FunctionServiceType), 1);
    equal(countType(state, EventsRuleServiceType), 2);
  });
});
