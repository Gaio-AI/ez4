import type { EntryState, EntryStates } from '@ez4/state';

import { describe, it } from 'node:test';
import { ok, equal } from 'node:assert/strict';

import {
  CloudWatchLogsClient,
  CreateLogStreamCommand,
  DeleteLogGroupCommand,
  DescribeLogGroupsCommand,
  PutLogEventsCommand
} from '@aws-sdk/client-cloudwatch-logs';

import { createLogGroup, hasUnexpiredLogs, isLogGroupState, registerTriggers } from '@ez4/aws-logs';
import { deploy } from '@ez4/aws-common';
import { deepClone } from '@ez4/utils';

const DAY_IN_MS = 24 * 60 * 60 * 1000;

const logsClient = new CloudWatchLogsClient({});

const assertDeploy = async <E extends EntryState>(resourceId: string, newState: EntryStates<E>, oldState: EntryStates<E> | undefined) => {
  const { result: state } = await deploy(newState, oldState);

  const resource = state[resourceId];

  ok(resource?.result);
  ok(isLogGroupState(resource));

  const { groupArn } = resource.result;

  ok(groupArn);

  return {
    result: resource.result,
    state
  };
};

const logGroupExists = async (groupName: string) => {
  const response = await logsClient.send(
    new DescribeLogGroupsCommand({
      logGroupIdentifiers: [groupName]
    })
  );

  return !!response.logGroups?.length;
};

describe('group :: unexpired logs', () => {
  const now = Date.now();

  it('has nothing to keep when no stream ever received an event', () => {
    equal(hasUnexpiredLogs(7, undefined, now), false);
  });

  it('keeps logs that have not reached the retention', () => {
    equal(hasUnexpiredLogs(7, now - DAY_IN_MS, now), true);
  });

  it('has nothing to keep once the retention has passed', () => {
    equal(hasUnexpiredLogs(7, now - 8 * DAY_IN_MS, now), false);
  });

  it('keeps logs without a retention, which never expire', () => {
    equal(hasUnexpiredLogs(undefined, now - 365 * DAY_IN_MS, now), true);
  });
});

describe('group', { timeout: 60000 }, () => {
  let lastState: EntryStates | undefined;
  let groupId: string | undefined;

  registerTriggers();

  it('assert :: deploy', async () => {
    const localState: EntryStates = {};

    const resource = createLogGroup(localState, {
      groupName: 'ez4-test-log-group',
      retention: 7,
      tags: {
        test1: 'ez4-tag1',
        test2: 'ez4-tag2'
      }
    });

    groupId = resource.entryId;

    const { state } = await assertDeploy(groupId, localState, undefined);

    lastState = state;
  });

  it('assert :: update', async () => {
    ok(groupId && lastState);

    const localState = deepClone(lastState);
    const resource = localState[groupId];

    ok(resource && isLogGroupState(resource));

    resource.parameters.retention = undefined;

    const { state } = await assertDeploy(groupId, localState, lastState);

    lastState = state;
  });

  it('assert :: update tags', async () => {
    ok(groupId && lastState);

    const localState = deepClone(lastState);
    const resource = localState[groupId];

    ok(resource && isLogGroupState(resource));

    resource.parameters.tags = {
      test2: 'ez4-tag2',
      test3: 'ez4-tag3'
    };

    const { state } = await assertDeploy(groupId, localState, lastState);

    lastState = state;
  });

  // Without `force`: the group never received an event, so there is nothing to keep.
  it('assert :: destroy', async () => {
    ok(groupId && lastState);

    ok(lastState[groupId]);

    const { result, warnings } = await deploy(undefined, lastState);

    equal(result[groupId], undefined);
    equal(warnings.length, 0);
    equal(await logGroupExists('ez4-test-log-group'), false);
  });
});

describe('group with recent logs', { timeout: 60000 }, () => {
  const groupName = 'ez4-test-log-group-with-logs';

  // A run that fails midway leaves the group behind, and its stream name would collide on the next.
  const streamName = `recent-${Date.now()}`;

  let lastState: EntryStates | undefined;
  let groupId: string | undefined;

  registerTriggers();

  it('assert :: deploy', async () => {
    const localState: EntryStates = {};

    const resource = createLogGroup(localState, {
      groupName,
      retention: 1
    });

    groupId = resource.entryId;

    const { state } = await assertDeploy(groupId, localState, undefined);

    await logsClient.send(
      new CreateLogStreamCommand({
        logGroupName: groupName,
        logStreamName: streamName
      })
    );

    await logsClient.send(
      new PutLogEventsCommand({
        logGroupName: groupName,
        logStreamName: streamName,
        logEvents: [{ timestamp: Date.now(), message: 'recent event' }]
      })
    );

    lastState = state;
  });

  it('assert :: destroy keeps it while its logs have not expired', async () => {
    ok(groupId && lastState);

    const { result, warnings } = await deploy(undefined, lastState);

    ok(result[groupId]);
    equal(warnings.length, 1);
    equal(await logGroupExists(groupName), true);

    lastState = result;
  });

  it('assert :: destroy with force', async () => {
    ok(groupId && lastState);

    const { result } = await deploy(undefined, lastState, {
      force: true
    });

    equal(result[groupId], undefined);
    equal(await logGroupExists(groupName), false);
  });
});

// A stream's event timestamps are accounted a while after ingestion, so a stream that has not shown
// one yet still counts from its creation.
describe('group with a fresh stream', { timeout: 60000 }, () => {
  const groupName = 'ez4-test-log-group-fresh-stream';

  let lastState: EntryStates | undefined;
  let groupId: string | undefined;

  registerTriggers();

  it('assert :: deploy', async () => {
    const localState: EntryStates = {};

    const resource = createLogGroup(localState, {
      groupName,
      retention: 1
    });

    groupId = resource.entryId;

    const { state } = await assertDeploy(groupId, localState, undefined);

    await logsClient.send(
      new CreateLogStreamCommand({
        logGroupName: groupName,
        logStreamName: `fresh-${Date.now()}`
      })
    );

    lastState = state;
  });

  it('assert :: destroy keeps it', async () => {
    ok(groupId && lastState);

    const { result, warnings } = await deploy(undefined, lastState);

    ok(result[groupId]);
    equal(warnings.length, 1);

    lastState = result;
  });

  it('assert :: destroy with force', async () => {
    ok(groupId && lastState);

    const { result } = await deploy(undefined, lastState, {
      force: true
    });

    equal(result[groupId], undefined);
    equal(await logGroupExists(groupName), false);
  });
});

describe('group deleted outside the deploy', { timeout: 60000 }, () => {
  const groupName = 'ez4-test-log-group-deleted-outside';

  let lastState: EntryStates | undefined;
  let groupId: string | undefined;

  registerTriggers();

  it('assert :: deploy', async () => {
    const localState: EntryStates = {};

    const resource = createLogGroup(localState, {
      groupName,
      retention: 1
    });

    groupId = resource.entryId;

    const { state } = await assertDeploy(groupId, localState, undefined);

    await logsClient.send(
      new DeleteLogGroupCommand({
        logGroupName: groupName
      })
    );

    lastState = state;
  });

  it('assert :: destroy drops it from the state', async () => {
    ok(groupId && lastState);

    const { result, warnings } = await deploy(undefined, lastState);

    equal(result[groupId], undefined);
    equal(warnings.length, 0);
  });
});
