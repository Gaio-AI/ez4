import type { EntryState, EntryStates } from '@ez4/state';

import { ok, equal, deepEqual, rejects } from 'node:assert/strict';
import { describe, it } from 'node:test';
import { join } from 'node:path';

import {
  createBucket,
  createBucketEvent,
  createBucketEventFunction,
  getBucketEventFunctionAliasArn,
  isBucketState,
  registerTriggers,
  StaleObjectTag
} from '@ez4/aws-bucket';
import { ArchitectureType, RuntimeType } from '@ez4/project';
import { createLogGroup } from '@ez4/aws-logs';
import { createRole } from '@ez4/aws-identity';
import { deploy, getAwsClientOptions } from '@ez4/aws-common';
import { GetBucketLifecycleConfigurationCommand, HeadBucketCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { deepClone } from '@ez4/utils';

import { getRoleDocument } from './common/role';

const assertDeploy = async <E extends EntryState>(resourceId: string, newState: EntryStates<E>, oldState: EntryStates<E> | undefined) => {
  const { result: state } = await deploy(newState, oldState);

  const resource = state[resourceId];

  ok(resource?.result);
  ok(isBucketState(resource));

  const result = resource.result;

  ok(result.bucketName);

  return {
    result,
    state
  };
};

const s3 = new S3Client(getAwsClientOptions());

const fetchLifecycleRules = async (bucketName: string) => {
  const { Rules = [] } = await s3.send(new GetBucketLifecycleConfigurationCommand({ Bucket: bucketName }));

  return Rules;
};

describe('bucket resources', { timeout: 60000 }, () => {
  const baseDir = 'test/files';

  let lastState: EntryStates | undefined;
  let bucketId: string | undefined;

  registerTriggers();

  it('assert :: deploy', async () => {
    const localState: EntryStates = {};

    const roleResource = createRole(localState, [], {
      roleName: 'ez4-test-bucket-event-role',
      roleDocument: getRoleDocument()
    });

    const logGroupResource = createLogGroup(localState, {
      groupName: 'ez4-test-bucket-event-logs',
      retention: 1
    });

    const lambdaResource = createBucketEventFunction(localState, roleResource, logGroupResource, {
      functionName: 'ez4-test-bucket-event-lambda',
      architecture: ArchitectureType.Arm,
      runtime: RuntimeType.Node24,
      variables: [],
      memory: 128,
      timeout: 5,
      handler: {
        sourceFile: join(baseDir, 'lambda.js'),
        functionName: 'main',
        dependencies: []
      }
    });

    const resource = createBucket(localState, {
      bucketName: 'ez4-test-bucket',
      autoExpireDays: 5,
      tags: {
        test1: 'ez4-tag1',
        test2: 'ez4-tag2'
      },
      cors: {
        allowHeaders: ['content-type'],
        allowOrigins: ['http://localhost'],
        allowMethods: ['PUT']
      }
    });

    createBucketEvent(localState, resource, lambdaResource, {
      toService: 'ez4-test-bucket-event-lambda',
      fromPath: '*',
      eventGetters: [
        (context) => {
          return {
            functionArn: getBucketEventFunctionAliasArn('ez4-test-bucket', lambdaResource.entryId, context),
            events: ['s3:ObjectCreated:*'],
            path: '*'
          };
        }
      ]
    });

    bucketId = resource.entryId;

    const { result, state } = await assertDeploy(bucketId, localState, undefined);

    lastState = state;

    const [rule, ...otherRules] = await fetchLifecycleRules(result.bucketName);

    equal(otherRules.length, 0);
    equal(rule?.ID, 'ez4-auto-expire');
    equal(rule?.Expiration?.Days, 5);
    equal(rule?.Filter?.Prefix ?? '', '');
  });

  it('assert :: update cors', async () => {
    ok(bucketId && lastState);

    const localState = deepClone(lastState);
    const resource = localState[bucketId];

    ok(resource && isBucketState(resource));

    resource.parameters.cors = undefined;

    const { state } = await assertDeploy(bucketId, localState, lastState);

    lastState = state;
  });

  it('assert :: update lifecycle', async () => {
    ok(bucketId && lastState);

    const localState = deepClone(lastState);
    const resource = localState[bucketId];

    ok(resource && isBucketState(resource));

    resource.parameters.autoExpireDays = undefined;

    const { result, state } = await assertDeploy(bucketId, localState, lastState);

    lastState = state;

    await rejects(fetchLifecycleRules(result.bucketName), { name: 'NoSuchLifecycleConfiguration' });
  });

  it('assert :: update tags', async () => {
    ok(bucketId && lastState);

    const localState = deepClone(lastState);
    const resource = localState[bucketId];

    ok(resource && isBucketState(resource));

    resource.parameters.tags = {
      test2: 'ez4-tag2',
      test3: 'ez4-tag3'
    };

    const { state } = await assertDeploy(bucketId, localState, lastState);

    lastState = state;
  });

  it('assert :: destroy', async () => {
    ok(bucketId && lastState);

    ok(lastState[bucketId]);

    const { result } = await deploy(undefined, lastState, {
      force: true
    });

    equal(result[bucketId], undefined);
  });
});

describe('bucket stale lifecycle', { timeout: 60000 }, () => {
  let lastState: EntryStates | undefined;
  let bucketName: string | undefined;
  let bucketId: string | undefined;

  registerTriggers();

  it('assert :: deploy', async () => {
    const localState: EntryStates = {};

    const resource = createBucket(localState, {
      bucketName: 'ez4-test-bucket-stale',
      staleExpireDays: 7
    });

    bucketId = resource.entryId;

    const { result, state } = await assertDeploy(bucketId, localState, undefined);

    bucketName = result.bucketName;
    lastState = state;

    const [rule, ...otherRules] = await fetchLifecycleRules(bucketName);

    equal(otherRules.length, 0);
    equal(rule?.ID, 'ez4-stale-expire');
    equal(rule?.Expiration?.Days, 7);
    deepEqual(rule?.Filter?.Tag, { Key: StaleObjectTag.key, Value: StaleObjectTag.value });
  });

  it('assert :: update lifecycle', async () => {
    ok(bucketId && bucketName && lastState);

    const localState = deepClone(lastState);
    const resource = localState[bucketId];

    ok(resource && isBucketState(resource));

    resource.parameters.autoExpireDays = 30;

    const { state } = await assertDeploy(bucketId, localState, lastState);

    lastState = state;

    const rules = await fetchLifecycleRules(bucketName);

    deepEqual(rules.map(({ ID, Expiration }) => [ID, Expiration?.Days]).sort(), [
      ['ez4-auto-expire', 30],
      ['ez4-stale-expire', 7]
    ]);
  });

  it('assert :: destroy non-empty bucket', async () => {
    ok(bucketId && bucketName && lastState);

    await s3.send(new PutObjectCommand({ Bucket: bucketName, Key: 'assets/old-chunk.js', Body: 'stale' }));

    const { result } = await deploy(undefined, lastState, {
      force: true
    });

    equal(result[bucketId], undefined);

    await rejects(s3.send(new HeadBucketCommand({ Bucket: bucketName })));
  });
});
