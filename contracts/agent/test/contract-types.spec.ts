import { describe, it } from 'node:test';
import { ok, equal, deepEqual } from 'node:assert/strict';
import { Agent } from '@ez4/agent';
import { ServiceType, isAgentService, createAgentService, registerTriggers } from '@ez4/agent/library';

const options: Agent.InvokeOptions = {
  id: 'run-1',
  workspace: [{ repo: 'api', base: 'a1', head: 'b2', ref: 'refs/ez4/Impl/run-1', changed: true }]
};

const resultWorkspace: Agent.Result<Agent.Service<{ task: string }, { done: boolean }>>['workspace'] = options.workspace;
const prepareWorkspace: Agent.PrepareRequest<{ task: string }>['workspace'] = { dir: '/work', repos: { api: { path: '/work/api', base: 'a1' } } };
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
});
