import type { AgentService, AgentWorkflowService } from '@ez4/agent/library';
import type { DeployOptions, EventContext, MetadataReflection } from '@ez4/project/library';
import type { EntryState, EntryStates } from '@ez4/state';
import type { RoleState } from '@ez4/aws-identity';

import { describe, it } from 'node:test';
import { deepEqual, equal } from 'node:assert/strict';
import { join } from 'node:path';

import { createAgentService, createAgentWorkflowService } from '@ez4/agent/library';
import { RoleServiceType } from '@ez4/aws-identity';
import { createLogGroup } from '@ez4/aws-logs';
import { SchemaType } from '@ez4/schema';

import { buildAgentExecutionRole } from '../src/role/execution';
import { buildAgentTaskRole } from '../src/role/task';
import { prepareDispatcher } from '../src/dispatch/resources';
import { prepareWorkflowResources } from '../src/workflow/resources';

// The package bundler defines __MODULE_PATH; source imports in tests need it set.
(globalThis as { __MODULE_PATH?: string }).__MODULE_PATH = join(import.meta.dirname, '../dist');

describe('agent roles permissions boundary', () => {
  const region = 'us-east-1';
  const accountId = '123456789012';

  const baseOptions: DeployOptions = {
    prefix: 'stg',
    projectName: 'proj',
    branchName: 'main',
    lockId: 'test-lock'
  };

  const worker = {
    ...createAgentService('Worker'),
    inputSchema: { type: SchemaType.Object, properties: {} }
  } as AgentService;

  const workflow: AgentWorkflowService = {
    ...createAgentWorkflowService('ReviewLoop'),
    inputSchema: { type: SchemaType.Object, properties: {} },
    agents: {
      worker: 'Worker'
    },
    handler: {
      name: 'handle',
      file: 'test/fixtures/workflow.ts',
      position: [1, 1]
    }
  };

  const metadata: MetadataReflection = { Worker: worker };

  const context: EventContext = {
    role: null,
    getServiceState: () => {
      throw new Error('Not found');
    },
    setServiceState: () => {},
    getVirtualServiceState: () => undefined,
    setVirtualServiceState: () => {},
    getDependencyFiles: () => []
  };

  const prepareAgentRoles = async (options: DeployOptions) => {
    const state: EntryStates = {};

    buildAgentTaskRole(state, worker, options, accountId);
    buildAgentExecutionRole(state, worker, options, region, accountId);

    prepareDispatcher(state, options, {
      region,
      accountId,
      bucketName: 'bucket',
      clusterName: 'cluster',
      logGroup: createLogGroup(state, { groupName: 'stg-proj-main-agents-dispatcher', retention: 30 }),
      bundle: async () => ''
    });

    await prepareWorkflowResources(state, workflow, metadata, context, options, {
      identity: async () => ({ region, accountId })
    });

    return Object.values(state)
      .filter((entry): entry is EntryState => !!entry)
      .filter((entry): entry is RoleState => entry.type === RoleServiceType)
      .map(({ parameters }) => [parameters.roleName, parameters.permissionsBoundary])
      .sort(([a], [b]) => String(a).localeCompare(String(b)));
  };

  it('assert :: every role an agent deploy creates gets the project permissions boundary', async () => {
    const roles = await prepareAgentRoles({ ...baseOptions, permissionsBoundary: 'Ez4Boundary-stg' });

    const boundaryArn = `arn:aws:iam::${accountId}:policy/Ez4Boundary-stg`;

    deepEqual(roles, [
      ['stg-proj-main-agents-dispatcher-role', boundaryArn],
      ['stg-proj-main-agents-execution-role', boundaryArn],
      ['stg-proj-main-agents-review-loop-role', boundaryArn],
      ['stg-proj-main-agents-worker-task-role', boundaryArn]
    ]);
  });

  it('assert :: without the option no agent role sets a boundary', async () => {
    const roles = await prepareAgentRoles(baseOptions);

    equal(roles.length, 4);

    for (const [roleName, permissionsBoundary] of roles) {
      equal(permissionsBoundary, undefined, `${roleName} sets a boundary`);
    }
  });
});
