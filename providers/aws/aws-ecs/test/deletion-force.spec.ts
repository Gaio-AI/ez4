import type { StepContext } from '@ez4/state';

import { describe, it } from 'node:test';
import { deepEqual } from 'node:assert/strict';

import { getEcsClusterHandler } from '../src/cluster/handler';
import { getEcsServiceHandler } from '../src/service/handler';
import { getEcsTaskDefHandler } from '../src/taskdef/handler';

const makeContext = () => {
  const warnings: string[] = [];

  const context = { force: false, addWarning: (message: string) => warnings.push(message) } as unknown as StepContext;

  return { context, warnings };
};

describe('ecs :: deletion needs --force', () => {
  it('keeps the cluster and says so', async () => {
    const { context, warnings } = makeContext();

    await getEcsClusterHandler().delete(
      {
        type: 'aws:ecs.cluster',
        entryId: 'c',
        dependencies: [],
        parameters: { clusterName: 'stg-agents' },
        result: { clusterArn: 'arn' }
      } as never,
      context
    );

    deepEqual(warnings, ["ECS cluster 'stg-agents' was kept; deleting it needs --force."]);
  });

  it('keeps the service and says so', async () => {
    const { context, warnings } = makeContext();

    await getEcsServiceHandler().delete(
      {
        type: 'aws:ecs.service',
        entryId: 's',
        dependencies: [],
        parameters: { serviceName: 'stg-agents-proxy', clusterName: 'stg-agents' },
        result: { serviceArn: 'arn' }
      } as never,
      context
    );

    deepEqual(warnings, ["ECS service 'stg-agents-proxy' was kept; deleting it needs --force."]);
  });

  it('keeps the task definition and says so', async () => {
    const { context, warnings } = makeContext();

    await getEcsTaskDefHandler().delete(
      {
        type: 'aws:ecs.taskdef',
        entryId: 't',
        dependencies: [],
        parameters: { family: 'ImplementAgent' },
        result: { taskDefinitionArn: 'arn' }
      } as never,
      context
    );

    deepEqual(warnings, ["ECS task definition 'ImplementAgent' was kept; deleting it needs --force."]);
  });

  it('has nothing to say about an entry that was never created', async () => {
    const { context, warnings } = makeContext();

    await getEcsClusterHandler().delete(
      { type: 'aws:ecs.cluster', entryId: 'c', dependencies: [], parameters: { clusterName: 'stg-agents' } } as never,
      context
    );

    deepEqual(warnings, []);
  });
});
