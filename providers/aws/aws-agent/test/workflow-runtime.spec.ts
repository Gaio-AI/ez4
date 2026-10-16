import { describe, it } from 'node:test';
import { deepEqual, rejects } from 'node:assert/strict';
import { type Agent, AgentResultStatus, WorkflowEventType } from '@ez4/agent';
import {
  runWorkflowStep,
  WorkflowConflictError,
  type WorkflowMessage,
  type WorkflowStore,
  type WorkflowInvoker
} from '../src/workflow/runtime';

interface LoopState {
  rounds: number;
}

type LoopWorkflow = Agent.Workflow<any, LoopState, any>;

const loop = async (request: Agent.WorkflowRequest<LoopWorkflow>): Promise<Agent.WorkflowStep<LoopState, any>> => {
  if (request.event.type === WorkflowEventType.Start) {
    return { state: { rounds: 0 }, next: { invoke: 'worker', input: { n: 1 } } };
  }
  const currentRounds = request.state?.rounds ?? 0;
  if (currentRounds < 1) {
    return { state: { rounds: 1 }, next: { invoke: 'worker', input: { n: 2 } } };
  }
  return { state: { rounds: 2 }, next: { complete: 'done' } };
};

function okResult(id: string, runId: string, step: number): Agent.Result<any> {
  return {
    id,
    agent: 'worker',
    status: AgentResultStatus.Succeeded,
    output: { ok: true },
    correlation: JSON.stringify({ workflow: 'Loop', runId, step }),
    finishedAt: new Date().toISOString()
  };
}

interface HarnessOptions {
  maxSteps?: number;
  failWrites?: number;
}

function harness(options: HarnessOptions = {}) {
  const records = new Map<string, { run: Agent.WorkflowRun<unknown>; etag: string }>();
  let etagCounter = 0;
  let failWritesRemaining = options.failWrites ?? 0;

  const store: WorkflowStore = {
    async read(runId: string) {
      const item = records.get(runId);
      if (!item) return undefined;
      return { run: JSON.parse(JSON.stringify(item.run)), etag: item.etag };
    },
    async write(run: Agent.WorkflowRun<unknown>, etag: string | undefined) {
      if (failWritesRemaining > 0) {
        failWritesRemaining--;
        return false;
      }
      const existing = records.get(run.runId);
      if (etag === undefined) {
        if (existing) {
          return false;
        }
      } else {
        if (!existing || existing.etag !== etag) {
          return false;
        }
      }
      const newEtag = `etag-${++etagCounter}`;
      records.set(run.runId, { run: JSON.parse(JSON.stringify(run)), etag: newEtag });
      return true;
    }
  };

  const invokes: { agent: string; input: unknown; options: Agent.InvokeOptions }[] = [];
  const invoke: WorkflowInvoker = async (agent, input, invokeOptions) => {
    invokes.push({ agent, input, options: invokeOptions });
    return { id: invokeOptions.id ?? 'generated-id' };
  };

  let idCounter = 0;
  const newId = () => `id-${++idCounter}`;
  const fixedTime = new Date('2026-10-15T12:00:00.000Z');
  const now = () => fixedTime;

  let handlerCallCount = 0;
  const run = async (
    message: WorkflowMessage,
    handler: (request: Agent.WorkflowRequest<any>) => Promise<Agent.WorkflowStep<unknown, any>>
  ) => {
    return runWorkflowStep({
      workflow: 'Loop',
      maxSteps: options.maxSteps ?? 10,
      message,
      handler: async (req) => {
        handlerCallCount++;
        return handler(req);
      },
      store,
      invoke,
      newId,
      now
    });
  };

  return {
    store,
    invokes,
    run,
    handlerCalls: () => handlerCallCount
  };
}

const harnessAfterStart = async () => {
  const h = harness();
  await h.run({ type: WorkflowEventType.Start, runId: 'r1', input: {} }, loop);
  return h;
};

describe('workflow :: step runtime', () => {
  it('assert :: start invokes the first agent after saving the run', async () => {
    const { store, invokes, run } = harness();
    deepEqual(await run({ type: WorkflowEventType.Start, runId: 'r1', input: {} }, loop), 'started');
    deepEqual(invokes, [
      {
        agent: 'worker',
        input: { n: 1 },
        options: { id: 'id-1', correlation: '{"workflow":"Loop","runId":"r1","step":1}', workspace: undefined }
      }
    ]);
    deepEqual((await store.read('r1'))?.run.waitingFor?.id, 'id-1');
  });

  it('assert :: duplicate result does not call the handler twice', async () => {
    const { run, handlerCalls } = await harnessAfterStart();
    const result = okResult('id-1', 'r1', 1);
    deepEqual(await run({ type: WorkflowEventType.Result, result }, loop), 'advanced');
    deepEqual(await run({ type: WorkflowEventType.Result, result }, loop), 'reinvoked');
    deepEqual(handlerCalls(), 2); // start + first result
  });

  it('assert :: stale result from an older step is ignored', async () => {
    const { run } = await harnessAfterStart();
    deepEqual(await run({ type: WorkflowEventType.Result, result: okResult('not-waiting', 'r1', 1) }, loop), 'ignored');
  });

  it('assert :: completion stores the outcome', async () => {
    const { run, store } = await harnessAfterStart();
    await run({ type: WorkflowEventType.Result, result: okResult('id-1', 'r1', 1) }, loop);
    deepEqual(await run({ type: WorkflowEventType.Result, result: okResult('id-2', 'r1', 2) }, loop), 'completed');
    const saved = (await store.read('r1'))!.run;
    deepEqual([saved.status, saved.outcome, saved.state], ['completed', 'done', { rounds: 2 }]);
  });

  it('assert :: exceeding maxSteps fails the run', async () => {
    const { run, store } = harness({ maxSteps: 1 });
    await run({ type: WorkflowEventType.Start, runId: 'r1', input: {} }, loop);
    deepEqual(await run({ type: WorkflowEventType.Result, result: okResult('id-1', 'r1', 1) }, loop), 'failed');
    deepEqual((await store.read('r1'))!.run.reason, 'max_steps');
  });

  it('assert :: conflicting write throws and invokes nothing', async () => {
    const { run, invokes } = harness({ failWrites: 1 });
    await rejects(() => run({ type: WorkflowEventType.Start, runId: 'r1', input: {} }, loop), WorkflowConflictError);
    deepEqual(invokes, []);
  });

  it('assert :: failed agent result reaches the handler', async () => {
    const seen: string[] = [];
    const { run } = await harnessAfterStart();
    await run({ type: WorkflowEventType.Result, result: { ...okResult('id-1', 'r1', 1), status: AgentResultStatus.Failed, output: undefined } }, async (request) => {
      if (request.event.type === WorkflowEventType.Result) seen.push(request.event.result.status);
      return { state: { rounds: 0 }, next: { complete: 'blocked' } };
    });
    deepEqual(seen, ['failed']);
  });

  it('assert :: result for non-existent run is ignored', async () => {
    const { run } = harness();
    deepEqual(await run({ type: WorkflowEventType.Result, result: okResult('id-1', 'r-none', 1) }, loop), 'ignored');
  });

  it('assert :: result with mismatching workflow in correlation is ignored', async () => {
    const { run } = await harnessAfterStart();
    const result = {
      ...okResult('id-1', 'r1', 1),
      correlation: JSON.stringify({ workflow: 'OtherWorkflow', runId: 'r1', step: 1 })
    };
    deepEqual(await run({ type: WorkflowEventType.Result, result }, loop), 'ignored');
  });

  it('assert :: result with invalid correlation is ignored', async () => {
    const { run } = await harnessAfterStart();
    const result = {
      ...okResult('id-1', 'r1', 1),
      correlation: 'invalid-json'
    };
    deepEqual(await run({ type: WorkflowEventType.Result, result }, loop), 'ignored');
  });

  it('assert :: result for completed or failed run is ignored', async () => {
    const { run } = await harnessAfterStart();
    await run({ type: WorkflowEventType.Result, result: okResult('id-1', 'r1', 1) }, loop);
    await run({ type: WorkflowEventType.Result, result: okResult('id-2', 'r1', 2) }, loop); // completed
    deepEqual(await run({ type: WorkflowEventType.Result, result: okResult('id-2', 'r1', 2) }, loop), 'ignored');
  });

  it('assert :: duplicate start with no waitingFor is ignored', async () => {
    const { run } = harness();
    deepEqual(
      await run({ type: WorkflowEventType.Start, runId: 'r1', input: {} }, async () => ({
        state: { rounds: 0 },
        next: { complete: 'immediate' }
      })),
      'completed'
    );
    deepEqual(await run({ type: WorkflowEventType.Start, runId: 'r1', input: {} }, loop), 'ignored');
  });
});
