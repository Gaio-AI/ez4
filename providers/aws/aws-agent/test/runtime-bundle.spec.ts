import type { AgentService, AgentWorkflowService } from '@ez4/agent/library';
import type { DeployOptions, EventContext } from '@ez4/project/library';
import type { EntryState, EntryStates, StepContext } from '@ez4/state';

import { describe, it } from 'node:test';
import { deepEqual, ok } from 'node:assert/strict';
import { join, relative } from 'node:path';

// The package bundler defines __MODULE_PATH; source imports in tests need it set.
(globalThis as { __MODULE_PATH?: string }).__MODULE_PATH = join(import.meta.dirname, '../dist');

import { AgentProvider } from '@ez4/agent';
import { createAgentService, createAgentWorkflowService } from '@ez4/agent/library';
import { getBundledPackages, getFunctionBundle } from '@ez4/aws-common';
import { isFunctionState } from '@ez4/aws-function';
import { SchemaType } from '@ez4/schema';

import { AGENT_IMAGE_PACKAGES } from '../src/image/dockerfile';
import { buildAgentBundle } from '../src/runtime/bundle';
import { buildDispatcherBundle } from '../src/dispatch/resources';
import { prepareWorkflowResources } from '../src/workflow/resources';
import { getAgentClientSource, prepareLinkedService } from '../src/triggers/client';

/**
 * What the deploy bundles from this package runs in an agent image or a Lambda function. The deploy code (and through
 * `@ez4/project`, the TypeScript compiler) has no business there, and neither has the provider SDK outside the image.
 */
describe('runtime bundles', () => {
  const options = { prefix: 'ez4', projectName: 'bundle', branchName: '', lockId: 'test-lock' } as DeployOptions;

  const handlerFile = relative(process.cwd(), join(import.meta.dirname, 'fixtures/handler.ts'));

  const agent = {
    ...createAgentService('BundleAgent'),
    provider: AgentProvider.Claude,
    model: 'model',
    instructions: 'instructions',
    inputSchema: { type: SchemaType.Object, properties: {} },
    outputSchema: { type: SchemaType.Object, properties: {} }
  } as AgentService;

  const workflow: AgentWorkflowService = {
    ...createAgentWorkflowService('BundleWorkflow'),
    inputSchema: { type: SchemaType.Object, properties: {} },
    agents: { worker: agent.name },
    handler: { name: 'handle', file: handlerFile, position: [1, 1] }
  };

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

  const assertPackages = (bundleFile: string, forbidden: string[]) => {
    const packages = getBundledPackages(bundleFile);

    ok(packages, `${bundleFile} was not bundled in this process`);

    const names = packages.map(({ path }) => path.slice(path.lastIndexOf('node_modules/') + 'node_modules/'.length));

    deepEqual(
      names.filter((name) => forbidden.includes(name)),
      []
    );
  };

  it('assert :: the agent image carries no TypeScript', async () => {
    const { file } = await buildAgentBundle(agent, options);

    assertPackages(file, ['typescript']);
  });

  it('assert :: the dispatcher carries no TypeScript nor the provider SDK', async () => {
    const file = await buildDispatcherBundle();

    assertPackages(file, ['typescript', ...AGENT_IMAGE_PACKAGES]);
  });

  it('assert :: the workflow function and its agent clients carry no TypeScript nor the provider SDK', async () => {
    const state: EntryStates = {};

    await prepareWorkflowResources(state, workflow, { [agent.name]: agent }, context, options, {
      identity: async () => ({ region: 'us-east-1', accountId: '123456789012' })
    });

    const workflowFunction = Object.values(state).find((entry): entry is EntryState => !!entry && isFunctionState(entry));

    ok(workflowFunction && isFunctionState(workflowFunction));

    const stepContext = { getDependencies: () => [], getConnections: () => [] } as unknown as StepContext;

    const file = await workflowFunction.parameters.getFunctionBundle(stepContext);

    assertPackages(file, ['typescript', ...AGENT_IMAGE_PACKAGES]);
  });

  it('assert :: a function linked to an agent and a workflow carries no TypeScript nor the provider SDK', async () => {
    const workflowSource = prepareLinkedService({ service: workflow, options, context });

    ok(workflowSource);

    const file = await getFunctionBundle('test', {
      resourceName: 'linked-function',
      filePrefix: 'linked',
      templateFile: join(import.meta.dirname, 'fixtures/function.ts'),
      context: {
        agent: getAgentClientSource(agent, options),
        workflow: workflowSource
      },
      handler: { functionName: 'route', sourceFile: handlerFile },
      target: 'node22'
    });

    assertPackages(file, ['typescript', ...AGENT_IMAGE_PACKAGES]);
  });
});
