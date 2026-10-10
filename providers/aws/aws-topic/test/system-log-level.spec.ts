import type { DeployOptions, EventContext, ServiceStates } from '@ez4/project/library';
import type { TopicService } from '@ez4/topic/library';
import type { EntryStates } from '@ez4/state';

import { describe, it } from 'node:test';
import { equal, ok } from 'node:assert/strict';

import { getServiceState, setServiceState } from '@ez4/project/library';
import { TopicSubscriptionType } from '@ez4/topic/library';
import { isFunctionState } from '@ez4/aws-function';
import { createRole } from '@ez4/aws-identity';
import { LogLevel } from '@ez4/project';

import { prepareServices } from '../src/triggers/service';
import { getRoleDocument } from './common/role';

const service = {
  type: '@ez4/topic',
  name: 'LogLevelTopic',
  context: {},
  variables: {},
  services: {},
  schema: {
    type: 'object',
    properties: {}
  },
  subscriptions: [
    {
      type: TopicSubscriptionType.Lambda,
      handler: {
        name: 'handleEvent',
        file: 'test/files/lambda.js'
      }
    }
  ]
} as unknown as TopicService;

const getContext = (state: EntryStates) => {
  const services: ServiceStates = {};

  const role = createRole(state, [], {
    roleName: 'ez4-test-system-log-level-role',
    roleDocument: getRoleDocument()
  });

  const context: Pick<EventContext, 'role' | 'setServiceState' | 'getServiceState' | 'getDependencyFiles'> = {
    role,
    setServiceState: (service, options, entry) => setServiceState(services, entry, service, options),
    getServiceState: (service, options) => getServiceState(services, service, options),
    getDependencyFiles: () => []
  };

  return context as EventContext;
};

/**
 * The system log level of the lambda subscription function the topic prepares.
 */
const getSystemLogLevel = (defaults?: DeployOptions['defaults']) => {
  const state: EntryStates = {};

  const options = {
    prefix: 'ez4',
    projectName: 'system-log-level',
    branchName: '',
    defaults
  } as DeployOptions;

  prepareServices({ state, service, metadata: {}, options, context: getContext(state) });

  const [functionState] = Object.values(state).filter((entry) => entry && isFunctionState(entry));

  ok(functionState && isFunctionState(functionState));

  return functionState.parameters.systemLogLevel;
};

describe('topic system log level', () => {
  it('assert :: the subscription function takes the project system log level', () => {
    equal(getSystemLogLevel({ systemLogLevel: LogLevel.Information }), 'information');
  });

  it('assert :: the subscription function leaves it undefined without the option', () => {
    equal(getSystemLogLevel(), undefined);
  });
});
