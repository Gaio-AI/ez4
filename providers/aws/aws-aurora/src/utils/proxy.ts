import { DBProxyNotFoundFault, DescribeDBProxiesCommand } from '@aws-sdk/client-rds';

import { getRDSClient } from './deploy';

export type ClusterProxy = {
  resourceId: string;
  endpoint: string;
};

const clusterProxies: Record<string, Promise<ClusterProxy | undefined>> = {};

/**
 * The RDS Proxy named after the cluster, when one exists and is available: native connections to the
 * cluster go through it. The proxy belongs to the infrastructure, so creating one is how a stage opts in.
 * Looked up once per process, as every function linking the database asks for it.
 */
export const getClusterProxy = (clusterName: string) => {
  clusterProxies[clusterName] ??= describeProxy(clusterName).catch((error) => {
    delete clusterProxies[clusterName];
    throw error;
  });

  return clusterProxies[clusterName];
};

const describeProxy = async (proxyName: string): Promise<ClusterProxy | undefined> => {
  try {
    const response = await getRDSClient().send(
      new DescribeDBProxiesCommand({
        DBProxyName: proxyName
      })
    );

    const proxy = response.DBProxies?.[0];

    if (proxy?.Status !== 'available' || !proxy.Endpoint || !proxy.DBProxyArn) {
      return undefined;
    }

    return {
      // The last segment of `arn:aws:rds:<region>:<account>:db-proxy:prx-...`, which IAM names the proxy by.
      resourceId: proxy.DBProxyArn.split(':').at(-1)!,
      endpoint: proxy.Endpoint
    };
  } catch (error) {
    if (error instanceof DBProxyNotFoundFault) {
      return undefined;
    }

    throw error;
  }
};
