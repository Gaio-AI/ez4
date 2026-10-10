import type { DeployOptions, EventContext, ServiceStates } from '@ez4/project/library';
import type { BucketService } from '@ez4/storage/library';
import type { EntryStates } from '@ez4/state';

import { describe, it } from 'node:test';
import { equal, ok } from 'node:assert/strict';

import { getServiceState, setServiceState } from '@ez4/project/library';
import { isFunctionState } from '@ez4/aws-function';
import { createRole } from '@ez4/aws-identity';
import { LogLevel } from '@ez4/project';

import { prepareBucketServices } from '../src/triggers/service';
import { getRoleDocument } from './common/role';

const service = {
  type: '@ez4/bucket',
  name: 'LogLevelBucket',
  globalName: 'log-level-bucket',
  context: {},
  variables: {},
  services: {},
  events: [
    {
      path: 'uploads/*',
      handler: {
        name: 'handleEvent',
        file: 'test/files/lambda.js'
      }
    }
  ]
} as unknown as BucketService;

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
 * The system log level of the event function the bucket prepares.
 */
const getSystemLogLevel = async (defaults?: DeployOptions['defaults']) => {
  const state: EntryStates = {};

  const options = {
    prefix: 'ez4',
    projectName: 'system-log-level',
    branchName: '',
    defaults
  } as DeployOptions;

  await prepareBucketServices({ state, service, metadata: {}, options, context: getContext(state) });

  const [functionState] = Object.values(state).filter((entry) => entry && isFunctionState(entry));

  ok(functionState && isFunctionState(functionState));

  return functionState.parameters.systemLogLevel;
};

describe('bucket system log level', () => {
  it('assert :: the event function takes the project system log level', async () => {
    equal(await getSystemLogLevel({ systemLogLevel: LogLevel.Information }), 'information');
  });

  it('assert :: the event function leaves it undefined without the option', async () => {
    equal(await getSystemLogLevel(), undefined);
  });
});
