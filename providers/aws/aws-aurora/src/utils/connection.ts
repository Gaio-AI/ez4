import type { PgClientDriver } from '@ez4/pgclient';
import type { Arn } from '@ez4/aws-common';
import type { NativeClientAddress } from '../client/drivers/native';

import { ApiClientDriver } from '../client/drivers/api';
import { NativeClientDriver } from '../client/drivers/native';
import { importCluster } from '../cluster/client';

/**
 * How the deploy reaches the database for migrations and integrity checks: `direct` connects to the writer, which
 * the deploy reaches from inside the cluster's VPC or through a tunnel to it, and runs each statement to its end.
 * Unset, it goes through the Data API, which stops waiting for a statement after 45 seconds.
 */
export const ConnectionVariable = 'EZ4_AURORA_CONNECTION';

/**
 * Local ends of tunnels to writers, as `<writer endpoint>=<host>:<port>`, separated by commas.
 */
export const TunnelsVariable = 'EZ4_AURORA_TUNNELS';

/**
 * Statements a deploy runs side by side at most (the integrity checks), and so the connections a direct one keeps.
 */
export const DeployConcurrency = 5;

const TUNNEL_PATTERN = /^([^=\s]+)=([^:\s]+):(\d+)$/;

export type DeployConnection = {
  clusterArn: Arn;
  secretArn: Arn;
  database: string;
};

export class InvalidConnectionError extends Error {
  constructor(value: string) {
    super(`${ConnectionVariable} must be 'direct' or unset, not '${value}'.`);
  }
}

export class InvalidTunnelError extends Error {
  constructor(entry: string) {
    super(`${TunnelsVariable} has an entry that isn't '<writer endpoint>=<host>:<port>': '${entry}'.`);
  }
}

export class WriterNotFoundError extends Error {
  constructor(clusterArn: Arn) {
    super(`Cluster '${clusterArn}' wasn't found to connect to its writer.`);
  }
}

export const getDeployDriver = async (connection: DeployConnection): Promise<PgClientDriver> => {
  const { clusterArn, secretArn, database } = connection;

  const mode = process.env[ConnectionVariable];

  if (!mode) {
    return new ApiClientDriver({
      resourceArn: clusterArn,
      secretArn,
      database
    });
  }

  if (mode !== 'direct') {
    throw new InvalidConnectionError(mode);
  }

  const cluster = await importCluster(undefined, clusterArn);

  if (!cluster) {
    throw new WriterNotFoundError(clusterArn);
  }

  return new NativeClientDriver({
    endpoint: cluster.writerEndpoint,
    address: getTunnelAddress(cluster.writerEndpoint),
    poolSize: DeployConcurrency,
    secretArn,
    database
  });
};

const getTunnelAddress = (endpoint: string): NativeClientAddress | undefined => {
  const tunnels = process.env[TunnelsVariable];

  if (!tunnels) {
    return undefined;
  }

  for (const entry of tunnels.split(',')) {
    const match = TUNNEL_PATTERN.exec(entry.trim());

    if (!match) {
      throw new InvalidTunnelError(entry.trim());
    }

    const [, target, host, port] = match;

    if (target === endpoint) {
      return { host: host!, port: Number(port) };
    }
  }

  return undefined;
};
