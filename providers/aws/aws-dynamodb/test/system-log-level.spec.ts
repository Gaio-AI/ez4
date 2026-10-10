import type { DeployOptions, EventContext, ServiceStates } from '@ez4/project/library';
import type { DatabaseService } from '@ez4/database/library';
import type { EntryStates } from '@ez4/state';

import { describe, it } from 'node:test';
import { equal, ok } from 'node:assert/strict';

import { InsensitiveMode, LockMode, OrderMode, PaginationMode, ParametersMode, TransactionMode, Index } from '@ez4/database';
import { getServiceState, setServiceState } from '@ez4/project/library';
import { isFunctionState } from '@ez4/aws-function';
import { createRole } from '@ez4/aws-identity';
import { SchemaType } from '@ez4/schema';
import { LogLevel } from '@ez4/project';

import { prepareDatabaseServices } from '../src/triggers/service';
import { getRoleDocument } from './common/role';

const service = {
  type: '@ez4/database',
  name: 'LogLevelDb',
  context: {},
  variables: {},
  services: {},
  engine: {
    name: 'dynamodb',
    parametersMode: ParametersMode.OnlyIndex,
    transactionMode: TransactionMode.Static,
    insensitiveMode: InsensitiveMode.Unsupported,
    paginationMode: PaginationMode.Cursor,
    orderMode: OrderMode.IndexColumns,
    lockMode: LockMode.Unsupported
  },
  tables: [
    {
      name: 'records',
      schema: {
        type: SchemaType.Object,
        properties: {
          id: {
            type: SchemaType.String
          }
        }
      },
      indexes: [
        {
          name: 'id',
          columns: ['id'],
          type: Index.Primary
        }
      ],
      stream: {
        handler: {
          name: 'handleChange',
          file: 'test/files/lambda.js'
        }
      }
    }
  ]
} as unknown as DatabaseService;

const getContext = (state: EntryStates) => {
  const services: ServiceStates = {};

  const role = createRole(state, [], {
    roleName: 'ez4-test-system-log-level-role',
    roleDocument: getRoleDocument()
  });

  const context: Pick<EventContext, 'role' | 'setServiceState' | 'getServiceState' | 'setVirtualServiceState' | 'getDependencyFiles'> = {
    role,
    setServiceState: (service, options, entry) => setServiceState(services, entry, service, options),
    getServiceState: (service, options) => getServiceState(services, service, options),
    setVirtualServiceState: () => {},
    getDependencyFiles: () => []
  };

  return context as EventContext;
};

/**
 * The system log level of the stream function the table prepares.
 */
const getSystemLogLevel = (defaults?: DeployOptions['defaults']) => {
  const state: EntryStates = {};

  const options = {
    prefix: 'ez4',
    projectName: 'system-log-level',
    branchName: '',
    defaults
  } as DeployOptions;

  prepareDatabaseServices({ state, service, metadata: {}, options, context: getContext(state) });

  const [functionState] = Object.values(state).filter((entry) => entry && isFunctionState(entry));

  ok(functionState && isFunctionState(functionState));

  return functionState.parameters.systemLogLevel;
};

describe('dynamodb system log level', () => {
  it('assert :: the stream function takes the project system log level', () => {
    equal(getSystemLogLevel({ systemLogLevel: LogLevel.Information }), 'information');
  });

  it('assert :: the stream function leaves it undefined without the option', () => {
    equal(getSystemLogLevel(), undefined);
  });
});
