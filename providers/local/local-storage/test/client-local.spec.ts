import type { ServeOptions } from '@ez4/project/library';
import type { Bucket } from '@ez4/storage';

import { deepEqual, equal, rejects } from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { BucketEventType } from '@ez4/storage';
import { toKebabCase } from '@ez4/utils';

import { createLocalClient } from '../src/client/local';

const BUCKET_PREFIX = 'localClient';

const options = {
  prefix: 'ez4',
  projectName: 'storage',
  branchName: '',
  serviceHost: 'localhost:0',
  version: 1,
  localOptions: {},
  testOptions: {}
} as ServeOptions;

const pngContent = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00,
  0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01,
  0x00, 0x00, 0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82
]);

const missingKeyError = {
  name: 'NoSuchKey',
  message: 'The specified key does not exist.'
};

// Every bucket in this file shares the same prefix, so all its files can be removed before and after the tests.
const removeBuckets = async () => {
  const directory = '.ez4';
  const prefix = toKebabCase(BUCKET_PREFIX);

  const entries = await readdir(directory).catch(() => []);

  for (const entry of entries) {
    if (entry.startsWith(prefix)) {
      await rm(join(directory, entry), { recursive: true, force: true });
    }
  }
};

const createClient = (name: string) => {
  const events: Bucket.ObjectEvent[] = [];

  const client = createLocalClient(`${BUCKET_PREFIX}${name}`, {
    ...options,
    events: [
      {
        prefix: '',
        suffix: '',
        handler: async (event) => {
          events.push(event);
        }
      }
    ]
  });

  return { client, events };
};

const collectKeys = async (entries: AsyncGenerator<{ key: string }, void>) => {
  const keys: string[] = [];

  for await (const { key } of entries) {
    keys.push(key);
  }

  return keys;
};

const settle = async () => {
  for (let turn = 0; turn < 10; turn++) {
    await new Promise((resolve) => setImmediate(resolve));
  }
};

describe('local storage client', () => {
  before(removeBuckets);
  after(removeBuckets);

  it('assert :: write keeps the content type and metadata', async () => {
    const { client } = createClient('Attributes');

    await client.write('folder/sub/b.json', '{"a":1}', {
      contentType: 'application/json',
      metadata: {
        origin: 'upload'
      }
    });

    deepEqual(await client.stat('folder/sub/b.json'), {
      type: 'application/json',
      size: 7,
      metadata: {
        origin: 'upload'
      }
    });
  });

  it('assert :: write takes the content type from the options or the key', async () => {
    const { client } = createClient('ContentType');

    await client.write('other.csv', 'a,b', {
      contentType: 'text/csv'
    });

    await client.write('guess.csv', 'a,b');

    equal((await client.stat('other.csv'))?.type, 'text/csv');
    equal((await client.stat('guess.csv'))?.type, 'text/csv');
  });

  it('assert :: stat does not inspect the content', async () => {
    const { client } = createClient('NoSniffing');

    await client.write('image', pngContent);

    deepEqual(await client.stat('image'), {
      type: 'binary/octet-stream',
      size: pngContent.length,
      metadata: {}
    });
  });

  it('assert :: metadata keys are stored in lowercase', async () => {
    const { client } = createClient('MetadataCase');

    await client.write('file.txt', 'content', {
      metadata: {
        Origin: 'Upload'
      }
    });

    deepEqual((await client.stat('file.txt'))?.metadata, {
      origin: 'Upload'
    });
  });

  it('assert :: stat and exists ignore directories', async () => {
    const { client } = createClient('Directories');

    await client.write('folder/a.txt', 'content');

    equal(await client.stat('folder'), undefined);
    equal(await client.exists('folder'), false);
    equal(await client.exists('folder/a.txt'), true);
  });

  it('assert :: read of a missing key throws NoSuchKey', async () => {
    const { client } = createClient('ReadMissing');

    await rejects(client.read('missing.txt'), missingKeyError);
  });

  it('assert :: delete of a missing key succeeds without an event', async () => {
    const { client, events } = createClient('DeleteMissing');

    await client.delete('missing.txt');

    await client.write('file.txt', 'content');
    await client.delete('file.txt');

    await settle();

    deepEqual(
      events.map(({ eventType, objectKey }) => ({ eventType, objectKey })),
      [
        {
          eventType: BucketEventType.Create,
          objectKey: 'file.txt'
        },
        {
          eventType: BucketEventType.Delete,
          objectKey: 'file.txt'
        }
      ]
    );

    equal(await client.exists('file.txt'), false);
  });

  it('assert :: delete removes the object attributes', async () => {
    const { client } = createClient('DeleteAttributes');

    await client.write('file', 'content', {
      contentType: 'text/plain',
      metadata: {
        origin: 'upload'
      }
    });

    await client.delete('file');

    // An object stored by other means doesn't inherit the attributes of the deleted one.
    await writeFile(join('.ez4', toKebabCase(`${BUCKET_PREFIX}DeleteAttributes`), 'file'), 'content');

    deepEqual(await client.stat('file'), {
      type: 'binary/octet-stream',
      size: 7,
      metadata: {}
    });
  });

  it('assert :: copy to the same key does nothing', async () => {
    const { client, events } = createClient('CopySame');

    await client.write('file.txt', 'content');
    await client.copy('file.txt', 'file.txt');

    await settle();

    equal((await client.read('file.txt')).toString(), 'content');
    equal(events.length, 1);
  });

  it('assert :: copy creates the target with the source attributes', async () => {
    const { client } = createClient('CopyAttributes');

    await client.write('other.csv', 'a,b', {
      contentType: 'text/csv',
      metadata: {
        origin: 'upload'
      }
    });

    await client.copy('other.csv', 'newdir/copy.csv');

    equal((await client.read('newdir/copy.csv')).toString(), 'a,b');

    deepEqual(await client.stat('newdir/copy.csv'), {
      type: 'text/csv',
      size: 3,
      metadata: {
        origin: 'upload'
      }
    });
  });

  it('assert :: copy fires the create event for the target', async () => {
    const { client, events } = createClient('CopyEvent');

    await client.write('file.txt', 'content');
    await client.copy('file.txt', 'copy/file.txt');

    await settle();

    deepEqual(
      events.map(({ eventType, objectKey, objectSize }) => ({ eventType, objectKey, objectSize })),
      [
        {
          eventType: BucketEventType.Create,
          objectKey: 'file.txt',
          objectSize: 7
        },
        {
          eventType: BucketEventType.Create,
          objectKey: 'copy/file.txt',
          objectSize: 7
        }
      ]
    );
  });

  it('assert :: copy of a missing key throws NoSuchKey', async () => {
    const { client } = createClient('CopyMissing');

    await rejects(client.copy('missing.txt', 'copy.txt'), missingKeyError);
  });

  it('assert :: scan yields objects by key prefix from the bucket root', async () => {
    const { client } = createClient('Scan');

    await client.write('other.csv', 'a,b', {
      contentType: 'text/csv'
    });

    await client.write('folder/sub/b.json', '{}', {
      metadata: {
        origin: 'upload'
      }
    });

    await client.write('folder/a.txt', 'content');

    deepEqual(await collectKeys(client.scan('folder/')), ['folder/a.txt', 'folder/sub/b.json']);
    deepEqual(await collectKeys(client.scan('fol')), ['folder/a.txt', 'folder/sub/b.json']);
    deepEqual(await collectKeys(client.scan('missing/')), []);
    deepEqual(await collectKeys(client.scan()), ['folder/a.txt', 'folder/sub/b.json', 'other.csv']);
  });

  it('assert :: scan of an empty bucket yields nothing', async () => {
    const { client } = createClient('ScanEmpty');

    deepEqual(await collectKeys(client.scan()), []);
  });
});

describe('local storage events', () => {
  before(removeBuckets);
  after(removeBuckets);

  const waitFor = async (condition: () => boolean) => {
    for (let turn = 0; turn < 1000 && !condition(); turn++) {
      await new Promise((resolve) => setImmediate(resolve));
    }
  };

  const createFailingClient = (name: string, failures: number) => {
    const attempts: number[] = [];

    const client = createLocalClient(`${BUCKET_PREFIX}${name}`, {
      ...options,
      events: [
        {
          prefix: '',
          suffix: '',
          handler: async () => {
            attempts.push(Date.now());

            if (attempts.length <= failures) {
              throw new Error('Handler failure.');
            }
          }
        }
      ]
    });

    return { client, attempts };
  };

  it('assert :: failed event handler is retried twice then dropped', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 0 });

    const { client, attempts } = createFailingClient('EventDropped', Infinity);

    await client.write('file.txt', 'content');

    await waitFor(() => attempts.length === 1);
    await settle();

    t.mock.timers.tick(1000);

    await waitFor(() => attempts.length === 2);
    await settle();

    t.mock.timers.tick(2000);

    await waitFor(() => attempts.length === 3);
    await settle();

    t.mock.timers.tick(60000);

    await settle();

    deepEqual(attempts, [0, 1000, 3000]);
  });

  it('assert :: event handler that recovers is not retried again', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 0 });

    const { client, attempts } = createFailingClient('EventRecovered', 1);

    await client.write('file.txt', 'content');

    await waitFor(() => attempts.length === 1);
    await settle();

    t.mock.timers.tick(1000);

    await waitFor(() => attempts.length === 2);
    await settle();

    t.mock.timers.tick(60000);

    await settle();

    deepEqual(attempts, [0, 1000]);
  });
});
