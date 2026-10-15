import { describe, it } from 'node:test';
import { ok, equal, deepEqual } from 'node:assert/strict';
import { Agent } from '@ez4/agent';
import { ServiceType, WorkflowServiceType, isAgentService, isAgentWorkflowService, createAgentService, createAgentWorkflowService, registerTriggers } from '@ez4/agent/library';

const options: Agent.InvokeOptions = {
  id: 'run-1',
  workspace: [{ repo: 'api', base: 'a1', head: 'b2', ref: 'refs/ez4/Impl/run-1', changed: true }]
};

const resultWorkspace: Agent.Result<Agent.Service<{ task: string }, { done: boolean }>>['workspace'] = options.workspace;
const prepareWorkspace: Agent.PrepareRequest<{ task: string }>['workspace'] = {
  dir: '/work',
  repos: { api: { path: '/work/api', base: 'a1' } }
};
const finishWorkspace: Agent.FinishRequest<{ task: string }, { done: boolean }>['workspace'] = {
  ...prepareWorkspace!,
  refs: options.workspace!
};
void resultWorkspace;
void finishWorkspace;

describe('agent contract types and scaffold', () => {
  it('assert :: service type constant is @ez4/agent', () => {
    equal(ServiceType, '@ez4/agent');
  });

  it('assert :: createAgentService populates default contract structure', () => {
    const service = createAgentService('TestAgent', 'src/test.ts', 'Test agent description');
    ok(isAgentService(service));
    equal(service.name, 'TestAgent');
    equal(service.type, '@ez4/agent');
    equal(service.file, 'src/test.ts');
    equal(service.description, 'Test agent description');
    deepEqual(service.variables, {});
    deepEqual(service.services, {});
  });

  it('assert :: Agent.Service abstract class can be subclassed for type checking', () => {
    interface CustomInput {
      readonly task: string;
    }
    interface CustomOutput {
      readonly result: string;
    }

    class TestAgentService extends Agent.Service<CustomInput, CustomOutput> {
      provider = 'claude' as const;
      model = 'claude-3-7-sonnet';
      instructions = 'Test agent instructions';
      input = {} as CustomInput;
      output = {} as CustomOutput;
    }

    const instance = new TestAgentService();
    equal(instance.provider, 'claude');
    equal(instance.model, 'claude-3-7-sonnet');
  });

  it('assert :: registerTriggers runs without error', () => {
    registerTriggers();
  });

  it('assert :: workflow service type constant is @ez4/agent-workflow', () => {
    equal(WorkflowServiceType, '@ez4/agent-workflow');
  });

  it('assert :: createAgentWorkflowService populates default structure', () => {
    const workflow = createAgentWorkflowService('TestWorkflow', 'src/workflow.ts', 'Test description');
    ok(isAgentWorkflowService(workflow));
    equal(workflow.name, 'TestWorkflow');
    equal(workflow.type, '@ez4/agent-workflow');
    equal(workflow.file, 'src/workflow.ts');
    equal(workflow.description, 'Test description');
    deepEqual(workflow.agents, {});
    deepEqual(workflow.variables, {});
    deepEqual(workflow.services, {});
  });

  it('assert :: WorkflowNext enforces valid invoke agent aliases and complete types', () => {
    type TestAgents = {
      worker: Agent.Service<{ task: string }, { done: boolean }>;
    };

    const validInvoke: Agent.WorkflowNext<TestAgents> = {
      invoke: 'worker',
      input: { task: 'build' }
    };
    const validComplete: Agent.WorkflowNext<TestAgents> = {
      complete: 'finished'
    };

    const invalidAlias: Agent.WorkflowNext<TestAgents> = {
      // @ts-expect-error Unknown agent alias is rejected
      invoke: 'unknown',
      input: { task: 'build' }
    };

    const invalidInput: Agent.WorkflowNext<TestAgents> = {
      invoke: 'worker',
      // @ts-expect-error Wrong input type for worker is rejected
      input: { task: 123 }
    };

    equal('invoke' in validInvoke, true);
    equal('complete' in validComplete, true);
    void invalidAlias;
    void invalidInput;
  });
});
