import { describe, it } from 'node:test';
import { deepEqual, equal, ok, rejects } from 'node:assert/strict';
import type { Agent } from '@ez4/agent';
import { dispatchDecision, type DispatchPorts } from '../src/dispatch/handler';

const agent = 'coder';
const id = 'task-456';
const queueUrl = 'https://sqs.us-east-1.amazonaws.com/123/results.fifo';
const invocationKey = `invocations/${agent}/${id}.json`;
const resultKey = `results/${agent}/${id}.json`;
const markerKey = `dispatched/${agent}/${id}`;
const now = new Date('2026-10-14T12:00:00.000Z');

const stoppedEvent = {
  source: 'aws.ecs',
  'detail-type': 'ECS Task State Change',
  detail: {
    lastStatus: 'STOPPED',
    stoppedReason: 'Essential container exited',
    containers: [{ exitCode: 137 }],
    overrides: {
      containerOverrides: [
        {
          environment: [
            { name: 'EZ4_AGENT_NAME', value: agent },
            { name: 'EZ4_AGENT_ID', value: id }
          ]
        }
      ]
    }
  }
};

const makePorts = () => {
  const storage = new Map<string, string>();
  const messages: { queueUrl: string; body: string; id: string; agentName: string }[] = [];
  const stopped: { cluster: string; taskArn: string }[] = [];
  const ports: DispatchPorts = {
    get: async (key) => storage.get(key),
    put: async (key, value) => {
      storage.set(key, value);
    },
    putConditional: async (key, value) => {
      if (storage.has(key)) return false;
      storage.set(key, value);
      return true;
    },
    list: async (prefix) => [...storage.keys()].filter((key) => key.startsWith(prefix)),
    send: async (url, body, messageId, group) => {
      messages.push({ queueUrl: url, body, id: messageId, agentName: group });
    },
    stopTask: async (cluster, taskArn) => {
      stopped.push({ cluster, taskArn });
    },
    now: () => now
  };
  return { storage, messages, stopped, ports };
};

describe('dispatcher decisions', () => {
  it('delivers an existing result once to its FIFO reply queue', async () => {
    const { storage, messages, ports } = makePorts();
    const result: Agent.Result<Agent.Service<Agent.Input, Agent.Output>> = {
      id,
      agent,
      status: 'succeeded',
      output: { patch: 'diff' },
      correlation: 'trace',
      finishedAt: now.toISOString()
    };
    storage.set(invocationKey, JSON.stringify({ replyTo: queueUrl, correlation: 'trace' }));
    storage.set(resultKey, JSON.stringify(result));

    await dispatchDecision(stoppedEvent, ports);
    await dispatchDecision(stoppedEvent, ports);

    ok(storage.has(markerKey));
    equal(messages.length, 1);
    deepEqual(messages[0], { queueUrl, body: JSON.stringify(result), id, agentName: agent });
  });

  it('retries a failed send before writing the marker and sends only once after success', async () => {
    const { storage, messages, ports } = makePorts();
    storage.set(invocationKey, JSON.stringify({ replyTo: queueUrl }));
    storage.set(resultKey, JSON.stringify({ id, agent, status: 'succeeded', finishedAt: now.toISOString() }));
    const send = ports.send;
    let attempts = 0;
    ports.send = async (...args) => {
      if (++attempts === 1) throw new Error('SQS unavailable');
      await send(...args);
    };

    await rejects(dispatchDecision(stoppedEvent, ports), /SQS unavailable/);
    equal(storage.has(markerKey), false);
    await dispatchDecision(stoppedEvent, ports);
    ok(storage.has(markerKey));
    await dispatchDecision(stoppedEvent, ports);
    equal(attempts, 2);
    equal(messages.length, 1);
  });

  it('records and delivers a failed task_stopped result for a task without output', async () => {
    const { storage, messages, ports } = makePorts();
    storage.set(invocationKey, JSON.stringify({ replyTo: queueUrl, correlation: 'trace' }));

    await dispatchDecision(stoppedEvent, ports);

    const result = JSON.parse(storage.get(resultKey)!);
    equal(result.status, 'failed');
    equal(result.error.code, 'task_stopped');
    ok(result.error.message.includes('137'));
    equal(result.correlation, 'trace');
    deepEqual(JSON.parse(messages[0].body), result);
  });

  it('stops an overdue task and delivers a timed_out result on the scheduled sweep', async () => {
    const { storage, messages, stopped, ports } = makePorts();
    storage.set(
      invocationKey,
      JSON.stringify({
        replyTo: queueUrl,
        deadline: '2026-10-14T11:59:59.000Z',
        cluster: 'cluster-1',
        taskArn: 'task-arn'
      })
    );

    await dispatchDecision({ source: 'aws.events' }, ports);

    deepEqual(stopped, [{ cluster: 'cluster-1', taskArn: 'task-arn' }]);
    const result = JSON.parse(storage.get(resultKey)!);
    equal(result.status, 'timed_out');
    equal(result.error.code, 'timeout');
    deepEqual(JSON.parse(messages[0].body), result);
  });

  it('does not send if the dispatch marker already exists', async () => {
    const { storage, messages, ports } = makePorts();
    storage.set(invocationKey, JSON.stringify({ replyTo: queueUrl }));
    storage.set(resultKey, JSON.stringify({ id, agent, status: 'succeeded', finishedAt: now.toISOString() }));
    storage.set(markerKey, 'another delivery');

    await dispatchDecision(stoppedEvent, ports);

    equal(messages.length, 0);
    equal(storage.get(markerKey), 'another delivery');
  });

  it('marks a stopped result without replyTo so a later sweep does not retry it', async () => {
    const { storage, messages, stopped, ports } = makePorts();
    storage.set(
      invocationKey,
      JSON.stringify({ correlation: 'trace', deadline: '2026-10-14T11:59:59.000Z', cluster: 'cluster-1', taskArn: 'task-arn' })
    );

    await dispatchDecision(stoppedEvent, ports);
    const result = storage.get(resultKey);
    ok(storage.has(markerKey));
    equal(JSON.parse(result!).status, 'failed');
    await dispatchDecision({ source: 'aws.events' }, ports);

    equal(storage.get(resultKey), result);
    deepEqual(stopped, []);
    deepEqual(messages, []);
  });

  it('dispatches an overdue stored result without timing out or stopping its task', async () => {
    const { storage, messages, stopped, ports } = makePorts();
    storage.set(
      invocationKey,
      JSON.stringify({ replyTo: queueUrl, deadline: '2026-10-14T11:59:59.000Z', cluster: 'cluster-1', taskArn: 'task-arn' })
    );
    const result = JSON.stringify({ id, agent, status: 'succeeded', finishedAt: now.toISOString() });
    storage.set(resultKey, result);

    await dispatchDecision({ source: 'aws.events' }, ports);

    equal(storage.get(resultKey), result);
    ok(storage.has(markerKey));
    deepEqual(stopped, []);
    deepEqual(
      messages.map((message) => message.body),
      [result]
    );
  });
});
