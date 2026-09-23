import type { EntryState, EntryStates } from '@ez4/state';

import { ok, equal, rejects } from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { deploy } from '@ez4/aws-common';
import { deepClone } from '@ez4/utils';

import { createBucket, createBucketObject, isBucketObjectState, isBucketState, registerTriggers, StaleObjectTag } from '@ez4/aws-bucket';
import { GetObjectTaggingCommand, HeadBucketCommand, HeadObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getAwsClientOptions } from '@ez4/aws-common';

const assertDeploy = async <E extends EntryState>(resourceId: string, newState: EntryStates<E>, oldState: EntryStates<E> | undefined) => {
  const { result: state } = await deploy(newState, oldState);

  const resource = state[resourceId];

  ok(resource?.result);
  ok(isBucketObjectState(resource));

  const result = resource.result;

  ok(result.bucketName);

  return {
    result,
    state
  };
};

describe('bucket objects', { timeout: 60000 }, () => {
  const baseDir = 'test/files';

  let lastState: EntryStates | undefined;
  let objectId: string | undefined;

  registerTriggers();

  it('assert :: deploy', async () => {
    const localState: EntryStates = {};

    const bucketResource = createBucket(localState, {
      bucketName: 'ez4-test-object-bucket'
    });

    const resource = createBucketObject(localState, bucketResource, {
      filePath: join(baseDir, 'object-file.txt'),
      objectKey: 'object-file.txt',
      tags: {
        test1: 'ez4-tag1',
        test2: 'ez4-tag2'
      }
    });

    objectId = resource.entryId;

    const { state } = await assertDeploy(objectId, localState, undefined);

    lastState = state;
  });

  it('assert :: update', async () => {
    ok(objectId && lastState);

    const localState = deepClone(lastState);
    const resource = localState[objectId];

    ok(resource && isBucketObjectState(resource));

    const filePath = join(baseDir, 'object-file.txt');
    const contents = readFileSync(filePath);

    writeFileSync(filePath, 'UPDATED FILE');

    resource.parameters.tags = {
      test2: 'ez4-tag2'
    };

    const { state } = await assertDeploy(objectId, localState, lastState);

    writeFileSync(filePath, contents);

    lastState = state;
  });

  it('assert :: update tags', async () => {
    ok(objectId && lastState);

    const localState = deepClone(lastState);
    const resource = localState[objectId];

    ok(resource && isBucketObjectState(resource));

    resource.parameters.tags = {
      test2: 'ez4-tag2',
      test3: 'ez4-tag3'
    };

    const { state } = await assertDeploy(objectId, localState, lastState);

    lastState = state;
  });

  it('assert :: destroy', async () => {
    ok(objectId && lastState);

    ok(lastState[objectId]);

    const { result } = await deploy(undefined, lastState);

    equal(result[objectId], undefined);
  });
});

describe('bucket stale objects', { timeout: 60000 }, () => {
  const s3 = new S3Client(getAwsClientOptions());
  const filePath = join('test/files', 'object-file.txt');

  let lastState: EntryStates | undefined;
  let bucketName: string | undefined;
  let bucketId: string | undefined;
  let staleId: string | undefined;
  let plainId: string | undefined;

  const getTags = async (objectKey: string) => {
    const { TagSet = [] } = await s3.send(new GetObjectTaggingCommand({ Bucket: bucketName, Key: objectKey }));

    return Object.fromEntries(TagSet.map(({ Key, Value }) => [String(Key), Value]));
  };

  const getCacheControl = async (objectKey: string) => {
    const { CacheControl } = await s3.send(new HeadObjectCommand({ Bucket: bucketName, Key: objectKey }));

    return CacheControl;
  };

  registerTriggers();

  it('assert :: deploy with cache control', async () => {
    const localState: EntryStates = {};

    const bucketResource = createBucket(localState, {
      bucketName: 'ez4-test-object-stale-bucket'
    });

    const staleResource = createBucketObject(localState, bucketResource, {
      objectKey: 'stale-file.txt',
      cacheControl: 'no-cache',
      staleExpireDays: 7,
      filePath
    });

    const plainResource = createBucketObject(localState, bucketResource, {
      objectKey: 'plain-file.txt',
      filePath
    });

    bucketId = bucketResource.entryId;
    staleId = staleResource.entryId;
    plainId = plainResource.entryId;

    const { result, state } = await assertDeploy(staleId, localState, undefined);

    bucketName = result.bucketName;

    equal(await getCacheControl('stale-file.txt'), 'no-cache');
    equal(await getCacheControl('plain-file.txt'), undefined);

    lastState = state;
  });

  it('assert :: update cache control keeps tags', async () => {
    ok(staleId && lastState);

    const localState = deepClone(lastState);
    const resource = localState[staleId];

    ok(resource && isBucketObjectState(resource));

    resource.parameters.cacheControl = 'public, max-age=60';
    resource.parameters.tags = { team: 'web' };

    const { state } = await assertDeploy(staleId, localState, lastState);

    equal(await getCacheControl('stale-file.txt'), 'public, max-age=60');
    equal((await getTags('stale-file.txt')).team, 'web');

    lastState = state;
  });

  it('assert :: removed objects', async () => {
    ok(staleId && plainId && lastState);

    const localState = deepClone(lastState);

    delete localState[staleId];
    delete localState[plainId];

    const { result } = await deploy(localState, lastState);

    equal(result[staleId], undefined);
    equal(result[plainId], undefined);

    const tags = await getTags('stale-file.txt');

    equal(tags[StaleObjectTag.key], StaleObjectTag.value);
    equal(tags.team, 'web');

    await rejects(getCacheControl('plain-file.txt'), { name: 'NotFound' });

    lastState = result;
  });

  it('assert :: restored object', async () => {
    ok(bucketId && staleId && lastState);

    const localState = deepClone(lastState);
    const bucketResource = localState[bucketId];

    ok(bucketResource && isBucketState(bucketResource));

    createBucketObject(localState, bucketResource, {
      objectKey: 'stale-file.txt',
      cacheControl: 'public, max-age=60',
      staleExpireDays: 7,
      tags: { team: 'web' },
      filePath
    });

    const { state } = await assertDeploy(staleId, localState, lastState);

    const tags = await getTags('stale-file.txt');

    equal(tags[StaleObjectTag.key], undefined);
    equal(tags.team, 'web');

    lastState = state;
  });

  it('assert :: destroy', async () => {
    ok(staleId && lastState);

    const oldState = deepClone(lastState);
    const resource = oldState[staleId];

    ok(resource && isBucketObjectState(resource));

    resource.parameters.staleExpireDays = undefined;

    await deploy(undefined, oldState);

    await rejects(s3.send(new HeadBucketCommand({ Bucket: bucketName })));
  });
});
