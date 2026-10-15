import { describe, it } from 'node:test';
import { rejects, equal, ok } from 'node:assert/strict';
import { registerTriggers } from '../src/main';
import { AgentNotEmulatedError } from '../src/errors/stub';
import { createAgentStubClient, createWorkflowEmulatorClient } from '../src/client/stub';
import type { AgentStubClient } from '../src/client/stub';
import { triggerAllAsync } from '@ez4/project/library';
import { createAgentService, createAgentWorkflowService } from '@ez4/agent/library';
import type { EmulateServiceEvent } from '@ez4/project/library';

describe('local agent stub emulator', () => {
  it('assert :: stub client invoke rejects with AgentNotEmulatedError', async () => {
    const client = createAgentStubClient('MyAgent');
    await rejects(
      async () => {
        await client.invoke({ task: 'run' } as unknown as never);
      },
      (error: unknown) => {
        ok(error instanceof AgentNotEmulatedError);
        equal(error.agentName, 'MyAgent');
        ok(error.message.includes('MyAgent'));
        ok(error.message.includes('not emulated locally'));
        return true;
      }
    );
  });

  it('assert :: stub client result rejects with AgentNotEmulatedError', async () => {
    const client = createAgentStubClient('MyAgent');
    await rejects(
      async () => {
        await client.result('inv-123');
      },
      (error: unknown) => {
        ok(error instanceof AgentNotEmulatedError);
        return true;
      }
    );
  });

  it('assert :: emulator:getServices returns stub emulator for agent services', async () => {
    registerTriggers();
    const dummyService = createAgentService('MyAgent');
    const result = await triggerAllAsync('emulator:getServices', (handler) => {
      const event: EmulateServiceEvent = {
        service: dummyService,
        options: {
          prefix: 'test',
          projectName: 'test',
          branchName: 'main',
          serviceHost: 'localhost',
          version: 1,
          localOptions: {},
          testOptions: {}
        },
        context: {
          makeClient: () => undefined,
          makeClients: () => ({})
        }
      };
      return handler(event);
    });
    ok(result);
    equal(result.type, 'Agent');
    equal(result.name, 'MyAgent');
    equal(typeof result.exportHandler, 'function');
    const stubClient = result.exportHandler?.({}) as AgentStubClient | undefined;
    ok(stubClient);
    await rejects(
      async () => {
        await stubClient.invoke({} as never);
      },
      (error: unknown) => {
        ok(error instanceof AgentNotEmulatedError);
        return true;
      }
    );
  });

  it('assert :: workflow start is not emulated', async () => {
    const client = createWorkflowEmulatorClient('ReviewLoop');
    await rejects(
      async () => {
        await client.start({ issueId: 'x' });
      },
      (error: unknown) => {
        ok(error instanceof AgentNotEmulatedError);
        equal(error.agentName, 'ReviewLoop');
        return true;
      }
    );
  });

  it('assert :: emulator:getServices returns stub emulator for workflow services', async () => {
    registerTriggers();
    const dummyWorkflow = createAgentWorkflowService('ReviewLoop');
    const result = await triggerAllAsync('emulator:getServices', (handler) => {
      const event: EmulateServiceEvent = {
        service: dummyWorkflow,
        options: {
          prefix: 'test',
          projectName: 'test',
          branchName: 'main',
          serviceHost: 'localhost',
          version: 1,
          localOptions: {},
          testOptions: {}
        },
        context: {
          makeClient: () => undefined,
          makeClients: () => ({})
        }
      };
      return handler(event);
    });
    ok(result);
    equal(result.type, 'AgentWorkflow');
    equal(result.name, 'ReviewLoop');
    equal(typeof result.exportHandler, 'function');
  });
});
