import { describe, it } from 'node:test';
import { deepEqual, ok } from 'node:assert/strict';

import { buildDispatcherGrants, buildTaskStoppedPattern } from '../src/dispatch/resources';

describe('dispatch resources', () => {
  it('assert :: task stopped event pattern', () => {
    deepEqual(JSON.parse(buildTaskStoppedPattern('arn:x')), {
      source: ['aws.ecs'],
      'detail-type': ['ECS Task State Change'],
      detail: { lastStatus: ['STOPPED'], clusterArn: ['arn:x'] }
    });
  });

  it('assert :: dispatcher identity grants', () => {
    const grants = buildDispatcherGrants('us-east-1', '123', 'b', 'c');
    const resourceIds = grants.flatMap((grant) => grant.resourceIds);

    ok(grants.some((grant) => grant.permissions.includes('s3:ListBucket') && grant.resourceIds.includes('arn:aws:s3:::b')));
    ok(resourceIds.includes('arn:aws:sqs:us-east-1:123:*.fifo'));
    ok(resourceIds.includes('arn:aws:ecs:us-east-1:123:task/c/*'));
  });
});
