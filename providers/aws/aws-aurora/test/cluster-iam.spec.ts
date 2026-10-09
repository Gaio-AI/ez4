import type { DatabaseService } from '@ez4/database/library';
import type { DeployOptions, EventContext, MetadataReflection } from '@ez4/project/library';
import type { EntryStates, StepContext, StepOptions } from '@ez4/state';
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

const getDatabase = (name: string, options?: AnyObject) => {
  return {
    type: '@ez4/database',
    name,
    context: {},
    variables: {},
    services: {},
    tables: [],
    engine: {
      name: 'aurora'
    },
    options
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

  it('assert :: link options override the database options', async () => {
    const native = getDatabase('db', { connectionMode: 'native', user: 'app' });

    const inherited = await prepareCluster(native, {
      db: native,
      worker: getLinker('db')
    } as unknown as MetadataReflection);

    equal(inherited.enableIamAuth, true);

    const overridden = await prepareCluster(native, {
      db: native,
      worker: getLinker('db', { connectionMode: 'api' })
    } as unknown as MetadataReflection);

    ok(!('enableIamAuth' in overridden));
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
 * What the cluster handler sends to RDS, answered in place by a cluster that turns IAM authentication on only
 * when asked, and reports it one read late, as RDS does: the cluster reads `available` again before the
 * setting takes effect. An update turns IAM authentication on when asked and never off, waits until it is in
 * effect, and doesn't rotate the master password, which the Data API signs in with.
 */
describe('aurora cluster requests', () => {
  const handler = getClusterHandler();
  const context = {} as StepContext;

  let commands: Command[];
  let cluster: { exists: boolean; iamEnabled: boolean; iamReadsUntilEnabled: number; iamReported: boolean };

  const getInputs = (name: string) => {
    return commands.filter((command) => command.constructor.name === name).map((command) => command.input);
  };

  const getInput = (name: string) => {
    const [input] = getInputs(name);

    ok(input, `${name} was not sent.`);

    return input;
  };

  const askIamAuth = (input: AnyObject) => {
    if (input.EnableIAMDatabaseAuthentication && !cluster.iamEnabled) {
      cluster.iamReadsUntilEnabled = 2;
    }
  };

  beforeEach(() => {
    commands = [];
    cluster = { exists: true, iamEnabled: false, iamReadsUntilEnabled: 0, iamReported: false };

    mock.method(RDSClient.prototype, 'send', async (command: Command) => {
      const name = command.constructor.name;

      commands.push(command);

      switch (name) {
        case 'DescribeDBClustersCommand':
          if (!cluster.exists) {
            throw new DBClusterNotFoundFault({ message: 'not found', $metadata: {} });
          }

          if (cluster.iamReadsUntilEnabled > 0 && --cluster.iamReadsUntilEnabled === 0) {
            cluster.iamEnabled = true;
          }

          cluster.iamReported ||= cluster.iamEnabled;

          return { DBClusters: [{ ...clusterResult, Status: 'available', IAMDatabaseAuthenticationEnabled: cluster.iamEnabled }] };

        case 'CreateDBClusterCommand':
          cluster.exists = true;
          cluster.iamEnabled = !!command.input.EnableIAMDatabaseAuthentication;
          return { DBCluster: clusterResult };

        case 'ModifyDBClusterCommand':
          askIamAuth(command.input);
          return { DBCluster: clusterResult };
      }

      throw new Error(`Unexpected RDS command ${name}.`);
    });
  });

  afterEach(() => {
    mock.restoreAll();
  });

  it('assert :: create with iam authentication', async () => {
    cluster.exists = false;

    await handler.create(getClusterState({ enableIamAuth: true }), context);

    equal(getInput('CreateDBClusterCommand').EnableIAMDatabaseAuthentication, true);
    ok(cluster.iamReported);
  });

  it('assert :: import of a cluster without iam authentication turns it on and waits for it', async () => {
    await handler.create(getClusterState({ enableIamAuth: true }), context);

    deepEqual(getInputs('ModifyDBClusterCommand'), [
      {
        DBClusterIdentifier: 'test-iam-db',
        EnableIAMDatabaseAuthentication: true,
        ApplyImmediately: true
      }
    ]);

    equal(getInputs('CreateDBClusterCommand').length, 0);
    ok(cluster.iamReported);
  });

  it('assert :: import of a cluster with iam authentication changes nothing', async () => {
    cluster.iamEnabled = true;

    await handler.create(getClusterState({ enableIamAuth: true }), context);

    equal(getInputs('ModifyDBClusterCommand').length, 0);
  });

  it('assert :: update turns iam authentication on, waits for it and does not rotate the master password', async () => {
    const current = getClusterState({ enableHttp: true, enableInsights: true, scalability: { minCapacity: 0.5, maxCapacity: 8 } });
    const candidate = getClusterState({
      enableHttp: true,
      enableInsights: true,
      scalability: { minCapacity: 0.5, maxCapacity: 8 },
      enableIamAuth: true
    });

    await handler.update(candidate, current, context);

    deepEqual(getInput('ModifyDBClusterCommand'), {
      DBClusterIdentifier: 'test-iam-db',
      DeletionProtection: true,
      EnablePerformanceInsights: true,
      EnableHttpEndpoint: true,
      EnableIAMDatabaseAuthentication: true,
      ApplyImmediately: true,
      ServerlessV2ScalingConfiguration: {
        MinCapacity: 0.5,
        MaxCapacity: 8
      }
    });

    ok(cluster.iamReported);
  });

  it('assert :: update without iam authentication leaves it as it is', async () => {
    cluster.iamEnabled = true;

    const current = getClusterState({ enableIamAuth: true, scalability: { minCapacity: 0.5, maxCapacity: 8 } });
    const candidate = getClusterState({ scalability: { minCapacity: 0.5, maxCapacity: 16 } });

    await handler.update(candidate, current, context);

    const input = getInput('ModifyDBClusterCommand');

    ok(!('EnableIAMDatabaseAuthentication' in input));
    ok(!('RotateMasterUserPassword' in input));
    deepEqual(input.ServerlessV2ScalingConfiguration, { MinCapacity: 0.5, MaxCapacity: 16 });
  });

  it('assert :: losing the last iam link is no change', async () => {
    cluster.iamEnabled = true;

    const current = getClusterState({ enableHttp: true, enableIamAuth: true });
    const candidate = getClusterState({ enableHttp: true });

    equal(await handler.preview(candidate, current, {} as StepOptions), undefined);

    await handler.update(candidate, current, context);

    equal(getInputs('ModifyDBClusterCommand').length, 0);
  });
});
