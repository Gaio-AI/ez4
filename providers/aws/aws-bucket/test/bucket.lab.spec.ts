import type { EntryState, EntryStates } from '@ez4/state';
import type { LifecycleRule } from '@aws-sdk/client-s3';

import { ok, equal, deepEqual, rejects } from 'node:assert/strict';
import { setTimeout } from 'node:timers/promises';
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
import {
  DeleteObjectCommand,
  GetBucketLifecycleConfigurationCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client
} from '@aws-sdk/client-s3';
import { deepClone } from '@ez4/utils';

import { getBucketName } from './common/names';
import { getRoleDocument } from './common/role';

const assertDeploy = async <E extends EntryState>(resourceId: string, newState: EntryStates<E>, oldState: EntryStates<E> | undefined) => {
  const { result: state, errors } = await deploy(newState, oldState);

  // A failed update keeps the resource's previous state, so only the errors tell it apart.
  deepEqual(errors, []);

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

// S3 serves the previous lifecycle configuration for a moment after a change, so the read waits,
// for a while, until it sees the rules the change leaves in place.
const fetchLifecycleRules = async (bucketName: string, expectedIds: string[]) => {
  const expected = [...expectedIds].sort().join();

  for (let attempt = 1; ; attempt++) {
    let rules: LifecycleRule[] = [];

    try {
      const { Rules = [] } = await s3.send(new GetBucketLifecycleConfigurationCommand({ Bucket: bucketName }));

      rules = Rules;
    } catch (error) {
      if (!(error instanceof Error) || error.name !== 'NoSuchLifecycleConfiguration') {
        throw error;
      }
    }

    const ruleIds = rules.map(({ ID }) => ID ?? '');

    if (ruleIds.sort().join() === expected || attempt === 20) {
      return rules;
    }

    await setTimeout(1000);
  }
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
      bucketName: getBucketName('bucket'),
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
            functionArn: getBucketEventFunctionAliasArn(getBucketName('bucket'), lambdaResource.entryId, context),
            events: ['s3:ObjectCreated:*'],
            path: '*'
          };
        }
      ]
    });

    bucketId = resource.entryId;

    const { result, state } = await assertDeploy(bucketId, localState, undefined);

    lastState = state;

    const [rule, ...otherRules] = await fetchLifecycleRules(result.bucketName, ['ez4-auto-expire']);

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

    deepEqual(await fetchLifecycleRules(result.bucketName, []), []);
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
      bucketName: getBucketName('bucket-stale'),
      staleExpireDays: 7
    });

    bucketId = resource.entryId;

    const { result, state } = await assertDeploy(bucketId, localState, undefined);

    bucketName = result.bucketName;
    lastState = state;

    const [rule, ...otherRules] = await fetchLifecycleRules(bucketName, ['ez4-stale-expire']);

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

    const rules = await fetchLifecycleRules(bucketName, ['ez4-auto-expire', 'ez4-stale-expire']);

    deepEqual(rules.map(({ ID, Expiration }) => [ID, Expiration?.Days]).sort(), [
      ['ez4-auto-expire', 30],
      ['ez4-stale-expire', 7]
    ]);
  });

  it('assert :: destroy keeps unmanaged objects', async () => {
    ok(bucketId && bucketName && lastState);

    await s3.send(new PutObjectCommand({ Bucket: bucketName, Key: 'assets/old-chunk.js', Body: 'stale', Tagging: 'ez4:stale=true' }));
    await s3.send(new PutObjectCommand({ Bucket: bucketName, Key: 'uploads/user-file.txt', Body: 'unmanaged' }));

    const { result } = await deploy(undefined, lastState, {
      force: true
    });

    equal(result[bucketId], undefined);

    await rejects(s3.send(new HeadObjectCommand({ Bucket: bucketName, Key: 'assets/old-chunk.js' })), { name: 'NotFound' });
    await s3.send(new HeadObjectCommand({ Bucket: bucketName, Key: 'uploads/user-file.txt' }));
  });

  it('assert :: destroy bucket', async () => {
    ok(bucketId && bucketName && lastState);

    await s3.send(new DeleteObjectCommand({ Bucket: bucketName, Key: 'uploads/user-file.txt' }));

    const { result } = await deploy(undefined, lastState, {
      force: true
    });

    equal(result[bucketId], undefined);

    await rejects(s3.send(new HeadBucketCommand({ Bucket: bucketName })));
  });
});
