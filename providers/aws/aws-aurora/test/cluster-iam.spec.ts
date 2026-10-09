import type { DatabaseService } from '@ez4/database/library';
import type { DeployOptions, EventContext, MetadataReflection } from '@ez4/project/library';
import type { EntryStates, StepContext } from '@ez4/state';
import type { AnyObject } from '@ez4/utils';
import type { ClusterParameters, ClusterState } from '../src/cluster/types';

import { describe, it, beforeEach, afterEach, mock } from 'node:test';
import { deepEqual, equal, ok } from 'node:assert/strict';

import { DBClusterNotFoundFault, RDSClient } from '@aws-sdk/client-rds';
import { triggerAllAsync } from '@ez4/project/library';

import { ClusterServiceType, registerTriggers } from '@ez4/aws-aurora';

import { getClusterHandler } from '../src/cluster/handler';

type Command = {
  constructor: { name: string };
  input: AnyObject;
};

const getDatabase = (name: string) => {
  return {
    type: '@ez4/database',
    name,
    context: {},
    variables: {},
    services: {},
    tables: [],
    engine: {
      name: 'aurora'
    }
  } as unknown as DatabaseService;
};

// A service linking a database, as an `Environment.Service<Db, { ...options }>` member becomes in the metadata.
const getLinker = (reference: string, options?: AnyObject) => {
  return {
    type: '@ez4/queue',
    name: 'worker',
    context: {},
    services: {
      db: { reference, options }
    }
  };
};

const options = {
  prefix: 'test',
  projectName: 'iam',
  branchName: '',
  tags: {}
} as unknown as DeployOptions;

// Through the trigger a deploy runs for each service, as the provider registers it.
const prepareCluster = async (database: DatabaseService, metadata: MetadataReflection) => {
  const state: EntryStates = {};

  const context = {
    setServiceState: () => {}
  } as unknown as EventContext;

  const event = { state, service: database, metadata, options, context };

  ok(await triggerAllAsync('deploy:prepareResources', (handler) => handler(event)));

  const cluster = Object.values(state).find((entry) => entry?.type === ClusterServiceType) as ClusterState | undefined;

  ok(cluster);

  return cluster.parameters;
};

/**
 * A native link that signs in as a `user` authenticates with IAM, so the cluster it links has IAM database
 * authentication turned on by the deploy. A cluster nothing links that way keeps its parameters, so it gets no
 * update.
 */
describe('aurora cluster iam authentication', () => {
  registerTriggers();

  it('assert :: native link with a user turns iam authentication on', async () => {
    const database = getDatabase('db');

    const parameters = await prepareCluster(database, {
      db: database,
      worker: getLinker('db', { connectionMode: 'native', user: 'app' })
    } as unknown as MetadataReflection);

    equal(parameters.enableIamAuth, true);
  });

  it('assert :: native link without a user leaves iam authentication out', async () => {
    const database = getDatabase('db');

    const parameters = await prepareCluster(database, {
      db: database,
      worker: getLinker('db', { connectionMode: 'native' })
    } as unknown as MetadataReflection);

    ok(!('enableIamAuth' in parameters));
  });

  it('assert :: data api link leaves iam authentication out', async () => {
    const database = getDatabase('db');

    const parameters = await prepareCluster(database, {
      db: database,
      worker: getLinker('db', { user: 'app' })
    } as unknown as MetadataReflection);

    ok(!('enableIamAuth' in parameters));
  });

  it('assert :: native link to another database leaves iam authentication out', async () => {
    const database = getDatabase('db');

    const parameters = await prepareCluster(database, {
      db: database,
      other: getDatabase('other'),
      worker: getLinker('other', { connectionMode: 'native', user: 'app' })
    } as unknown as MetadataReflection);

    ok(!('enableIamAuth' in parameters));
  });
});

const clusterResult = {
  DBClusterArn: 'arn:aws:rds:us-east-1:000000000000:cluster:test-iam-db',
  MasterUserSecret: { SecretArn: 'arn:aws:secretsmanager:us-east-1:000000000000:secret:rds!cluster' },
  Endpoint: 'writer',
  ReaderEndpoint: 'reader'
};

const getClusterState = (parameters: Omit<ClusterParameters, 'clusterName'>): ClusterState => {
  return {
    type: ClusterServiceType,
    entryId: 'cluster',
    dependencies: [],
    parameters: {
      clusterName: 'test-iam-db',
      ...parameters
    },
    result: {
      clusterArn: clusterResult.DBClusterArn,
      secretArn: clusterResult.MasterUserSecret.SecretArn,
      writerEndpoint: clusterResult.Endpoint,
      readerEndpoint: clusterResult.ReaderEndpoint
    }
  } as ClusterState;
};

/**
 * What the cluster handler sends to RDS, answered in place. An update turns IAM authentication on when asked and
 * never off, and doesn't rotate the master password, which the Data API signs in with.
 */
describe('aurora cluster requests', () => {
  const handler = getClusterHandler();
  const context = {} as StepContext;

  let commands: Command[];
  let clusterExists: boolean;

  const getInput = (name: string) => {
    const command = commands.find((command) => command.constructor.name === name);

    ok(command, `${name} was not sent.`);

    return command.input;
  };

  beforeEach(() => {
    commands = [];
    clusterExists = true;

    mock.method(RDSClient.prototype, 'send', async (command: Command) => {
      const name = command.constructor.name;

      commands.push(command);

      switch (name) {
        case 'DescribeDBClustersCommand':
          if (!clusterExists) {
            clusterExists = true;
            throw new DBClusterNotFoundFault({ message: 'not found', $metadata: {} });
          }

          return { DBClusters: [{ ...clusterResult, Status: 'available' }] };

        case 'CreateDBClusterCommand':
        case 'ModifyDBClusterCommand':
          return { DBCluster: clusterResult };
      }

      throw new Error(`Unexpected RDS command ${name}.`);
    });
  });

  afterEach(() => {
    mock.restoreAll();
  });

  it('assert :: create with iam authentication', async () => {
    clusterExists = false;

    const candidate = getClusterState({ enableIamAuth: true });

    await handler.create(candidate, context);

    equal(getInput('CreateDBClusterCommand').EnableIAMDatabaseAuthentication, true);
  });

  it('assert :: update turns iam authentication on without rotating the master password', async () => {
    const current = getClusterState({ enableHttp: true });
    const candidate = getClusterState({ enableHttp: true, enableIamAuth: true });

    await handler.update(candidate, current, context);

    const input = getInput('ModifyDBClusterCommand');

    equal(input.EnableIAMDatabaseAuthentication, true);
    equal(input.RotateMasterUserPassword, undefined);
  });

  it('assert :: update without iam authentication leaves it as it is', async () => {
    const current = getClusterState({ enableIamAuth: true, scalability: { minCapacity: 0.5, maxCapacity: 8 } });
    const candidate = getClusterState({ scalability: { minCapacity: 0.5, maxCapacity: 16 } });

    await handler.update(candidate, current, context);

    const input = getInput('ModifyDBClusterCommand');

    ok(!('EnableIAMDatabaseAuthentication' in input));
    equal(input.RotateMasterUserPassword, undefined);
    deepEqual(input.ServerlessV2ScalingConfiguration, { MinCapacity: 0.5, MaxCapacity: 16 });
  });
});
