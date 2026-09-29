import type { EmulateServiceContext, EmulatorRequestEvent, EmulatorResponse, ServeOptions } from '@ez4/project/library';
import type { BucketService } from '@ez4/storage/library';
import type { Bucket, Client } from '@ez4/storage';

import { deepEqual, equal } from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';

import { toKebabCase } from '@ez4/utils';

import { registerLocalService } from '../src/provider/local';

const BUCKET_PREFIX = 'localProvider';

const options = {
  prefix: 'ez4',
  projectName: 'storage',
  branchName: '',
  serviceHost: 'localhost:0',
  version: 1,
  localOptions: {},
  testOptions: {},
  local: true
} as ServeOptions;

const context = {
  makeClients: () => ({}),
  makeClient: () => undefined
} as unknown as EmulateServiceContext;

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

const startBucket = async (name: string, properties?: Partial<BucketService>) => {
  const service = {
    type: '@ez4/bucket',
    name: `${BUCKET_PREFIX}${name}`,
    services: {},
    variables: {},
    ...properties
  } as unknown as BucketService;

  const emulator = await registerLocalService(service, options, context);
  const client = emulator.exportHandler() as Client;

  const sendRequest = async (method: string, path: string, headers: Record<string, string> = {}, body?: string) => {
    const request: EmulatorRequestEvent = {
      method,
      path,
      headers,
      query: {},
      ...(body !== undefined && {
        body: Buffer.from(body)
      })
    };

    return (await emulator.requestHandler(request)) as EmulatorResponse;
  };

  return { client, sendRequest };
};

describe('local storage requests', () => {
  before(removeBuckets);
  after(removeBuckets);

  it('assert :: put keeps the content type and metadata from the headers', async () => {
    const { client, sendRequest } = await startBucket('Put');

    const response = await sendRequest(
      'PUT',
      '/folder/b.json',
      {
        ['content-type']: 'application/json',
        ['x-amz-meta-origin']: 'upload'
      },
      '{"a":1}'
    );

    equal(response.status, 204);

    deepEqual(await client.stat('folder/b.json'), {
      type: 'application/json',
      size: 7,
      metadata: {
        origin: 'upload'
      }
    });
  });

  it('assert :: get answers with the stored content type and cache headers', async () => {
    const { client, sendRequest } = await startBucket('Get');

    await client.write('page.txt', 'content', {
      contentType: 'text/html',
      headers: {
        cacheControl: 'max-age=60',
        expires: new Date('2026-10-01T00:00:00Z')
      }
    });

    const { status, headers, body } = await sendRequest('GET', '/page.txt');

    equal(status, 200);
    equal(body?.toString(), 'content');

    deepEqual(headers, {
      ['content-type']: 'text/html',
      ['cache-control']: 'max-age=60',
      ['expires']: 'Thu, 01 Oct 2026 00:00:00 GMT'
    });
  });

  it('assert :: put keeps the cache headers from the request', async () => {
    const { sendRequest } = await startBucket('PutCache');

    const headers = {
      ['content-type']: 'text/plain',
      ['cache-control']: 'no-cache',
      ['expires']: 'Thu, 01 Oct 2026 00:00:00 GMT'
    };

    await sendRequest('PUT', '/file.txt', headers, 'content');

    const response = await sendRequest('GET', '/file.txt');

    deepEqual(response.headers, headers);
  });

  it('assert :: head answers with the content length and type', async () => {
    const { sendRequest } = await startBucket('Head');

    await sendRequest('PUT', '/folder/b.json', { ['content-type']: 'application/json' }, '{"a":1}');

    deepEqual(await sendRequest('HEAD', '/folder/b.json'), {
      status: 200,
      headers: {
        ['content-length']: '7',
        ['content-type']: 'application/json'
      }
    });

    deepEqual(await sendRequest('HEAD', '/folder/missing.json'), {
      status: 404
    });
  });

  it('assert :: get of a missing key answers not found', async () => {
    const { sendRequest } = await startBucket('GetMissing');

    const response = await sendRequest('GET', '/missing.txt');

    equal(response.status, 404);
  });

  it('assert :: put fires the event for the key in the path', async () => {
    const { sendRequest } = await startBucket('PutEvent', {
      events: [
        {
          path: 'uploads/*',
          handler: {
            name: 'probeObjectEvent',
            file: 'test/fixtures/event-probe.ts',
            position: [1, 1]
          }
        }
      ]
    });

    const observed: Bucket.Incoming[] = [];

    globalThis.observeObjectEvent = (request) => observed.push(request);

    try {
      await sendRequest('PUT', '/uploads/a%20b.txt', { ['content-type']: 'text/plain' }, 'content');

      for (let turn = 0; turn < 1000 && !observed.length; turn++) {
        await new Promise((resolve) => setImmediate(resolve));
      }

      deepEqual(
        observed.map(({ eventType, objectKey, objectSize }) => ({ eventType, objectKey, objectSize })),
        [
          {
            eventType: 'create',
            objectKey: 'uploads/a b.txt',
            objectSize: 7
          }
        ]
      );
    } finally {
      globalThis.observeObjectEvent = undefined;
    }
  });
});
