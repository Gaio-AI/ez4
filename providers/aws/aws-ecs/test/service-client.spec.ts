import type { ECSClient } from '@aws-sdk/client-ecs';
import type { EcsServiceParameters } from '../src/service/types';

import { describe, it } from 'node:test';
import { deepEqual } from 'node:assert/strict';
import { setEcsClient } from '../src/cluster/client';
import { deleteEcsService } from '../src/service/client';

const parameters = { clusterName: 'agents', serviceName: 'agents-proxy' } as EcsServiceParameters;
const logger = { update: () => {} };

describe('ECS service client', () => {
  it('assert :: deleting a service returns only once its tasks have drained', async () => {
    const sent: string[] = [];
    const statuses = ['DRAINING', 'INACTIVE'];

    setEcsClient({
      send: async (command: { constructor: { name: string } }) => {
        const name = command.constructor.name;
        if (name !== 'DescribeServicesCommand') {
          sent.push(name);
          return {};
        }
        const status = statuses.shift();
        sent.push(`DescribeServicesCommand:${status}`);
        return { services: [{ serviceName: parameters.serviceName, status }], failures: [] };
      }
    } as unknown as ECSClient);

    try {
      await deleteEcsService(logger, parameters);
    } finally {
      setEcsClient(null);
    }

    deepEqual(sent, [
      'UpdateServiceCommand',
      'DeleteServiceCommand',
      'DescribeServicesCommand:DRAINING',
      'DescribeServicesCommand:INACTIVE'
    ]);
  });
});
