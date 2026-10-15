import { describe, it } from 'node:test';
import { deepEqual, throws } from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { buildMetadata } from '@ez4/project/library';
import { registerTriggers, type AgentService, type AgentWorkflowService, isAgentWorkflowService } from '@ez4/agent/library';
import { IncompleteServiceError, InvalidCpuMemoryCombinationError, UnknownPresetError } from '@ez4/agent/library';

const testFile = (fileName: string, overwrite = false) => {
  const sourceFile = `./test/input/output-${fileName}.ts`;
  const outputFile = `./test/output/${fileName}.json`;

  registerTriggers();
  const { metadata } = buildMetadata([sourceFile]);

  if (!existsSync(outputFile) || overwrite) {
    writeFileSync(outputFile, JSON.stringify(metadata, undefined, 2));
  } else {
    deepEqual(metadata, JSON.parse(readFileSync(outputFile).toString()));
  }
};

describe('agent metadata parser and validation', () => {
  it('assert :: basic agent metadata matches golden json', () => {
    testFile('basic-agent');
  });

  it('assert :: full agent with tools, hooks, and resources matches golden json', () => {
    testFile('full-agent');
  });

  it('assert :: workspace agent metadata matches golden json', () => {
    testFile('workspace-agent');
  });
  it('assert :: workflow metadata matches golden json', () => {
    testFile('workflow');
  });

  it('assert :: workflow maps aliases to agent classes', () => {
    registerTriggers();
    const { metadata } = buildMetadata(['./test/input/output-workflow.ts']);
    const workflow = metadata.ReviewLoop as AgentWorkflowService;
    deepEqual(workflow.agents, { worker: 'BasicAgent' });
    deepEqual(workflow.maxSteps, 4);
    deepEqual(workflow.handler.name, 'reviewLoopStep');
    deepEqual(isAgentWorkflowService(workflow), true);
  });

  it('assert :: workspace repos are normalized', () => {
    registerTriggers();
    const { metadata } = buildMetadata(['./test/input/output-workspace-agent.ts']);
    deepEqual((metadata.WorkspaceAgent as AgentService).workspace, {
      repos: [
        { url: 'https://github.com/acme/api.git', name: 'api', branch: 'main' },
        { url: 'https://github.com/acme/web.git', name: 'frontend', branch: 'develop' }
      ],
      auth: { githubApp: 'acme/github-app' }
    });
  });

  it('assert :: incomplete agent throws IncompleteServiceError', () => {
    throws(
      () => buildMetadata(['./test/input/incomplete-service.ts']),
      (error: unknown) =>
        error instanceof IncompleteServiceError || (error instanceof Error && error.message === 'No errors were expected.')
    );
  });

  it('assert :: invalid cpu/memory combo throws InvalidCpuMemoryCombinationError', () => {
    throws(
      () => buildMetadata(['./test/input/invalid-resources.ts']),
      (error: unknown) =>
        error instanceof InvalidCpuMemoryCombinationError || (error instanceof Error && error.message === 'No errors were expected.')
    );
  });

  it('assert :: unknown preset throws UnknownPresetError', () => {
    throws(
      () => buildMetadata(['./test/input/invalid-preset.ts']),
      (error: unknown) => error instanceof UnknownPresetError || (error instanceof Error && error.message === 'No errors were expected.')
    );
  });
});
