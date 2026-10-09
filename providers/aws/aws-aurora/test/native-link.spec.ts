import type { DatabaseService } from '@ez4/database/library';
import type { DeployOptions, EventContext, MetadataReflection } from '@ez4/project/library';
import type { AnyObject } from '@ez4/utils';

import { describe, it, beforeEach, afterEach, mock } from 'node:test';
import { deepEqual, equal, ok } from 'node:assert/strict';

import { DBClusterNotFoundFault, DBProxyNotFoundFault, RDSClient } from '@aws-sdk/client-rds';
import { STSClient } from '@aws-sdk/client-sts';
import { triggerAllAsync } from '@ez4/project/library';

import { ClusterServiceType, registerTriggers } from '@ez4/aws-aurora';

type PolicyDocument = {
  Statement: { Action: string[]; Resource: string[]; Condition?: AnyObject }[];
};

type Command = {
  constructor: { name: string };
  input: { DBProxyName?: string; DBClusterIdentifier?: string };
};

const AccountId = '123456789012';

const getService = (name: string, options?: AnyObject) => {
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

// A service linking databases, as `Environment.Service<Db, { ...options }>` members become in the metadata.
const getLinker = (services: Record<string, { reference: string; options?: AnyObject }>) => {
  return {
    type: '@ez4/queue',
    name: 'worker',
    context: {},
    services
  };
};

const getOptions = (prefix: string) => {
  return {
    prefix,
    projectName: 'link',
    branchName: '',
    tags: {}
  } as unknown as DeployOptions;
};

// The cluster entry answers for the service name, the integrity entry for anything else (the database name).
const getContext = (serviceName: string) => {
  return {
    getServiceState: (name: string) => {
      return name === serviceName
        ? { type: ClusterServiceType, entryId: 'cluster' }
        : { type: 'aws:aurora.integrity', entryId: 'integrity' };
    }
  } as unknown as EventContext;
};

// Through the triggers a deploy runs, as the provider registers them.
const prepareLinkedClient = async (context: EventContext, service: DatabaseService, options: DeployOptions) => {
  const source = await triggerAllAsync('deploy:prepareLinkedService', (handler) => handler({ target: service, service, options, context }));

  ok(source);

  return source;
};

const preparePolicyDocument = async (metadata: MetadataReflection, options: DeployOptions) => {
  const policy = await triggerAllAsync('deploy:prepareExecutionPolicy', (handler) =>
    handler({ state: {}, metadata, serviceType: '@ez4/database', options })
  );

  ok(policy);

  return (policy as unknown as { parameters: { policyDocument: PolicyDocument } }).parameters.policyDocument;
};

/**
 * How a function links an Aurora database, and the policy its role gets. A native connection goes through
 * the RDS Proxy named after the cluster when the stage has one, and signs in with IAM as `user`; IAM
 * authentication is granted on the project's own clusters and proxies, by resource id.
 *
 * RDS and STS are answered in place: proxies and clusters exist only as the test declares them. Every case
 * uses its own cluster names, since proxies are looked up once per process.
 */
describe('aurora native link', () => {
  registerTriggers();

  let proxies: Record<string, { arn: string; endpoint: string; status: string }>;
  let clusters: Record<string, string>;
  let rdsCommands: string[];

  beforeEach(() => {
    proxies = {};
    clusters = {};
    rdsCommands = [];

    mock.method(RDSClient.prototype, 'send', async (command: Command) => {
      const name = command.constructor.name;

      rdsCommands.push(name);

      if (name === 'DescribeDBProxiesCommand') {
        const proxy = proxies[command.input.DBProxyName!];

        if (!proxy) {
          throw new DBProxyNotFoundFault({ message: 'not found', $metadata: {} });
        }

        return { DBProxies: [{ DBProxyArn: proxy.arn, Endpoint: proxy.endpoint, Status: proxy.status }] };
      }

      if (name === 'DescribeDBClustersCommand') {
        const resourceId = clusters[command.input.DBClusterIdentifier!];

        if (!resourceId) {
          throw new DBClusterNotFoundFault({ message: 'not found', $metadata: {} });
        }

        return { DBClusters: [{ DbClusterResourceId: resourceId }] };
      }

      throw new Error(`Unexpected RDS command ${name}.`);
    });

    mock.method(STSClient.prototype, 'send', async () => {
      return { Account: AccountId };
    });
  });

  afterEach(() => {
    mock.restoreAll();
  });

  it('assert :: native connection through the proxy named after the cluster, signed in as the user', async () => {
    proxies['first-link-db'] = {
      arn: `arn:aws:rds:us-east-1:${AccountId}:db-proxy:prx-0first`,
      endpoint: 'first-link-db.proxy-abc.us-east-1.rds.amazonaws.com',
      status: 'available'
    };

    const service = getService('db', { connectionMode: 'native', user: 'app' });

    const source = await prepareLinkedClient(getContext('db'), service, getOptions('first'));

    equal(source.from, '@ez4/aws-aurora/client/native');
    equal(source.requireVpc, true);

    // The proxy is a function variable, so the link code is the same with or without it.
    ok(
      source.constructor.includes('endpoint: process.env["EZ4_AURORA_PROXY_FIRST_LINK_DB"] ?? __EZ4_CLUSTER_WRITER_ENDPOINT, user: "app"')
    );

    deepEqual(source.variables, {
      EZ4_AURORA_PROXY_FIRST_LINK_DB: 'first-link-db.proxy-abc.us-east-1.rds.amazonaws.com'
    });
  });

  it('assert :: native connection to the writer when the stage has no proxy', async () => {
    const service = getService('db', { connectionMode: 'native', user: 'app' });

    const source = await prepareLinkedClient(getContext('db'), service, getOptions('second'));

    ok(
      source.constructor.includes('endpoint: process.env["EZ4_AURORA_PROXY_SECOND_LINK_DB"] ?? __EZ4_CLUSTER_WRITER_ENDPOINT, user: "app"')
    );

    equal(source.variables, undefined);
  });

  it('assert :: native connection to the writer while the proxy is not available', async () => {
    proxies['third-link-db'] = {
      arn: `arn:aws:rds:us-east-1:${AccountId}:db-proxy:prx-0third`,
      endpoint: 'third-link-db.proxy-abc.us-east-1.rds.amazonaws.com',
      status: 'creating'
    };

    const service = getService('db', { connectionMode: 'native' });

    const source = await prepareLinkedClient(getContext('db'), service, getOptions('third'));

    ok(source.constructor.includes('endpoint: process.env["EZ4_AURORA_PROXY_THIRD_LINK_DB"] ?? __EZ4_CLUSTER_WRITER_ENDPOINT }'));

    equal(source.variables, undefined);
  });

  it('assert :: data api connection looks no proxy up', async () => {
    const source = await prepareLinkedClient(getContext('db'), getService('db'), getOptions('fourth'));

    equal(source.from, '@ez4/aws-aurora/client/api');
    equal(source.requireVpc, false);

    deepEqual(rdsCommands, []);
  });

  it('assert :: iam authentication granted on the project clusters and their proxies', async () => {
    clusters['fifth-link-console'] = 'cluster-CONSOLE';
    clusters['fifth-link-analytics'] = 'cluster-ANALYTICS';

    proxies['fifth-link-console'] = {
      arn: `arn:aws:rds:us-east-1:${AccountId}:db-proxy:prx-0console`,
      endpoint: 'fifth-link-console.proxy-abc.us-east-1.rds.amazonaws.com',
      status: 'available'
    };

    clusters['fifth-link-reports'] = 'cluster-REPORTS';

    const policyDocument = await preparePolicyDocument(
      {
        console: getService('console'),
        analytics: getService('analytics'),
        reports: getService('reports'),
        worker: getLinker({
          console: { reference: 'console', options: { connectionMode: 'native', user: 'app' } },
          analytics: { reference: 'analytics', options: { connectionMode: 'native' } },
          reports: { reference: 'reports' }
        })
      },
      getOptions('fifth')
    );

    const statement = policyDocument.Statement.find(({ Action }) => Action.includes('rds-db:connect'));

    ok(statement);

    const region = process.env.AWS_REGION;

    // The reports database is only linked through the Data API: no IAM authentication on it.
    deepEqual(statement.Resource, [
      `arn:aws:rds-db:${region}:${AccountId}:dbuser:cluster-ANALYTICS/*`,
      `arn:aws:rds-db:${region}:${AccountId}:dbuser:cluster-CONSOLE/*`,
      `arn:aws:rds-db:${region}:${AccountId}:dbuser:prx-0console/*`
    ]);
  });

  it('assert :: master secrets readable only for the project clusters', async () => {
    const policyDocument = await preparePolicyDocument(
      {
        reports: getService('reports'),
        worker: getLinker({ reports: { reference: 'reports' } })
      },
      getOptions('seventh')
    );

    const statement = policyDocument.Statement.find(({ Action }) => Action.includes('secretsmanager:GetSecretValue'));

    ok(statement);

    const region = process.env.AWS_REGION;

    deepEqual(statement.Resource, [`arn:aws:secretsmanager:${region}:${AccountId}:secret:rds!*`]);

    deepEqual(statement.Condition, {
      StringLike: {
        'secretsmanager:ResourceTag/aws:rds:primaryDBClusterArn': `arn:aws:rds:${region}:${AccountId}:cluster:seventh-link-*`
      }
    });
  });

  it('assert :: no iam authentication grant before the clusters exist', async () => {
    const policyDocument = await preparePolicyDocument(
      {
        console: getService('console'),
        worker: getLinker({ console: { reference: 'console', options: { connectionMode: 'native' } } })
      },
      getOptions('sixth')
    );

    equal(
      policyDocument.Statement.find(({ Action }) => Action.includes('rds-db:connect')),
      undefined
    );
  });

  it('assert :: a project on the data api looks nothing up', async () => {
    const policyDocument = await preparePolicyDocument(
      {
        console: getService('console'),
        worker: getLinker({ console: { reference: 'console' } })
      },
      getOptions('seventh')
    );

    deepEqual(rdsCommands, []);

    equal(
      policyDocument.Statement.find(({ Action }) => Action.includes('rds-db:connect')),
      undefined
    );
  });
});
