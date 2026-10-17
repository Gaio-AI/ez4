import type { StepContext } from '@ez4/state';

import { afterEach, describe, it, mock } from 'node:test';
import { deepEqual } from 'node:assert/strict';

import { S3Client } from '@aws-sdk/client-s3';

import { getBucketHandler } from '../src/bucket/handler';

const bucket = {
  type: 'aws:s3.bucket',
  entryId: 'b',
  dependencies: [],
  parameters: { bucketName: 'stg-agents-9d7e66' },
  result: { bucketName: 'stg-agents-9d7e66' }
} as never;

const makeContext = () => {
  const warnings: string[] = [];

  const context = { force: false, addWarning: (message: string) => warnings.push(message) } as unknown as StepContext;

  return { context, warnings };
};

const fakeS3 = (objects: { Key: string }[]) => {
  const sent: string[] = [];

  mock.method(S3Client.prototype, 'send', async (command: { constructor: { name: string } }) => {
    sent.push(command.constructor.name);

    return command.constructor.name === 'ListObjectsV2Command' ? { Contents: objects } : {};
  });

  return sent;
};

describe('bucket :: deletion of a bucket that holds objects', () => {
  afterEach(() => mock.restoreAll());

  it('keeps it, deletes nothing and says so', async () => {
    const sent = fakeS3([{ Key: 'workflows/CodeAgent/run.json' }]);
    const { context, warnings } = makeContext();

    await getBucketHandler().delete(bucket, context);

    deepEqual(sent, ['ListObjectsV2Command']);
    deepEqual(warnings, ["Bucket 'stg-agents-9d7e66' still holds objects, so it was kept."]);
  });

  it('deletes an empty bucket without a warning', async () => {
    const sent = fakeS3([]);
    const { context, warnings } = makeContext();

    await getBucketHandler().delete(bucket, context);

    deepEqual(sent, ['ListObjectsV2Command', 'DeleteBucketCommand']);
    deepEqual(warnings, []);
  });
});
