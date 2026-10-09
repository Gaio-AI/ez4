import type { DeployOptions, EventContext } from '@ez4/project/library';
import type { QueueService } from '@ez4/queue/library';
import type { EntryStates } from '@ez4/state';

import { describe, it } from 'node:test';
import { deepEqual } from 'node:assert/strict';

import { isQueueState } from '@ez4/aws-queue';
import { createRole } from '@ez4/aws-identity';

import { prepareServices } from '../src/triggers/service';
import { getRoleDocument } from './common/role';

const options = {
  prefix: 'ez4',
  projectName: 'defaults',
  branchName: ''
} as DeployOptions;

const getContext = (state: EntryStates) => {
  const role = createRole(state, [], {
    roleName: 'ez4-test-defaults-role',
    roleDocument: getRoleDocument()
  });

  return {
    role,
    setServiceState: () => {}
  } as unknown as EventContext;
};

const getService = (attributes: Partial<QueueService>) => {
  return {
    type: '@ez4/queue',
    name: 'DefaultsQueue',
    context: {},
    variables: {},
    services: {},
    subscriptions: [],
    schema: {
      type: 'object',
      properties: {}
    },
    ...attributes
  } as unknown as QueueService;
};

const getQueueParameters = (service: QueueService) => {
  const state: EntryStates = {};

  prepareServices({ state, service, metadata: {}, options, context: getContext(state) });

  const [queueState] = Object.values(state).filter((entry) => entry && isQueueState(entry));

  if (!queueState || !isQueueState(queueState)) {
    throw new Error('No queue state was prepared.');
  }

  const { delay, polling, timeout, retention } = queueState.parameters;

  return { delay, polling, timeout, retention };
};

describe('queue defaults', () => {
  it('assert :: an attribute the queue leaves out gets its default', () => {
    deepEqual(getQueueParameters(getService({})), {
      delay: 0,
      polling: 0,
      timeout: 150,
      retention: 20160
    });
  });

  it('assert :: a declared attribute is kept', () => {
    deepEqual(getQueueParameters(getService({ delay: 2, polling: 20, timeout: 30, retention: 60 })), {
      delay: 2,
      polling: 20,
      timeout: 30,
      retention: 60
    });
  });
});
