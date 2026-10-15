import type { StepOptions } from '@ez4/state';
import type { EcsClusterState } from '../src/cluster/types';
import { describe, it } from 'node:test';
import { ok, equal } from 'node:assert/strict';
import { createEcsCluster, createEcsClusterStateId } from '../src/cluster/service';
import { getEcsClusterHandler } from '../src/cluster/handler';
import { EcsClusterServiceType } from '../src/cluster/types';

describe('ECS cluster step handler', () => {
  it('assert :: creates cluster state entry with correct parameters and ID', () => {
    const states: Record<string, EcsClusterState> = {};

    const state = createEcsCluster(states, {
      clusterName: 'test-agent-cluster',
      tags: { Environment: 'test' }
    });

    equal(state.type, EcsClusterServiceType);
    equal(state.parameters.clusterName, 'test-agent-cluster');
    equal(state.parameters.tags?.Environment, 'test');
    equal(state.entryId, createEcsClusterStateId('test-agent-cluster'));
    ok(states[state.entryId] !== undefined);
  });

  it('assert :: handler equals compares clusterArn', () => {
    const handler = getEcsClusterHandler();

    const candidate: EcsClusterState = {
      type: EcsClusterServiceType,
      entryId: 'entry1',
      dependencies: [],
      parameters: { clusterName: 'test-cluster' },
      result: {
        clusterName: 'test-cluster',
        clusterArn: 'arn:aws:ecs:us-east-1:123456789012:cluster/test-cluster'
      }
    };

    const currentSame: EcsClusterState = {
      ...candidate
    };

    const currentDiff: EcsClusterState = {
      ...candidate,
      result: {
        ...candidate.result!,
        clusterArn: 'arn:aws:ecs:us-east-1:123456789012:cluster/other-cluster'
      }
    };

    ok(handler.equals(candidate, currentSame));
    ok(!handler.equals(candidate, currentDiff));
  });

  it('assert :: handler preview detects parameter changes', async () => {
    const handler = getEcsClusterHandler();
    const options = {} as StepOptions;
    const candidate: EcsClusterState = {
      type: EcsClusterServiceType,
      entryId: 'entry1',
      dependencies: [],
      parameters: {
        clusterName: 'test-cluster',
        tags: { Environment: 'production' }
      }
    };

    const currentSame: EcsClusterState = {
      ...candidate
    };

    const currentDiff: EcsClusterState = {
      type: EcsClusterServiceType,
      entryId: 'entry1',
      dependencies: [],
      parameters: {
        clusterName: 'test-cluster',
        tags: { Environment: 'staging' }
      }
    };

    equal(await handler.preview(candidate, currentSame, options), undefined);

    const changes = await handler.preview(candidate, currentDiff, options);
    ok(changes !== undefined);
    equal(changes.counts, 1);
  });
});
