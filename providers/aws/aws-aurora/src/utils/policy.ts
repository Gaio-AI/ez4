import type { IdentityGrant } from '@ez4/project/library';

import { getAccountId, getRegion, createPolicyDocument } from '@ez4/aws-identity';
import { DBClusterNotFoundFault, DescribeDBClustersCommand } from '@aws-sdk/client-rds';

import { getClusterProxy } from './proxy';
import { getRDSClient } from './deploy';

export const getPolicyDocument = async (prefix: string, clusterNames: string[]) => {
  const [region, accountId, databaseUsers] = await Promise.all([getRegion(), getAccountId(), getDatabaseUserResourceIds(clusterNames)]);

  const grants: IdentityGrant[] = [
    // An Aurora-managed master secret is named after nothing that says its cluster, so the grant reaches the
    // project's own ones by the cluster ARN that RDS tags each with. The Data API reads the secret with the
    // caller's permission, so it is held to the same clusters.
    {
      resourceIds: [`arn:aws:secretsmanager:${region}:${accountId}:secret:rds!*`],
      permissions: ['secretsmanager:GetSecretValue'],
      conditions: {
        StringLike: {
          'aws:ResourceTag/aws:rds:primaryDBClusterArn': `arn:aws:rds:${region}:${accountId}:cluster:${prefix}-*`
        }
      }
    },
    {
      resourceIds: [`arn:aws:rds:${region}:${accountId}:cluster:${prefix}-*`],
      permissions: ['rds-data:BeginTransaction', 'rds-data:CommitTransaction', 'rds-data:ExecuteStatement', 'rds-data:RollbackTransaction']
    }
  ];

  // IAM authentication names a cluster or a proxy by its resource id, not by its name, so the grant lists the
  // project's own clusters and their proxies. A cluster created in this same deploy has no id yet: its grant
  // comes with the next deploy.
  if (databaseUsers.length) {
    grants.push({
      resourceIds: databaseUsers.map((resourceId) => `arn:aws:rds-db:${region}:${accountId}:dbuser:${resourceId}/*`),
      permissions: ['rds-db:connect']
    });
  }

  return createPolicyDocument(grants);
};

const getDatabaseUserResourceIds = async (clusterNames: string[]) => {
  const resourceIds = await Promise.all(
    clusterNames.flatMap((clusterName) => [
      getClusterResourceId(clusterName),
      getClusterProxy(clusterName).then((proxy) => proxy?.resourceId)
    ])
  );

  return resourceIds.filter((resourceId) => resourceId !== undefined).sort();
};

const getClusterResourceId = async (clusterName: string) => {
  try {
    const response = await getRDSClient().send(
      new DescribeDBClustersCommand({
        DBClusterIdentifier: clusterName
      })
    );

    return response.DBClusters?.[0]?.DbClusterResourceId;
  } catch (error) {
    if (error instanceof DBClusterNotFoundFault) {
      return undefined;
    }

    throw error;
  }
};
