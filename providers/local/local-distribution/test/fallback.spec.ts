import type { EmulateServiceContext, ServiceEmulator } from '@ez4/project/library';
import type { OriginServer } from './common/origin';
import type { ServiceEmulators } from './common/storage';

import { equal, match } from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import { bucketOrigin, createDistribution, createService, getBody, options, regularOrigin, sendRequest } from './common/distribution';
import { createEmulateContext, createLocalBucket, removeLocalBucket } from './common/storage';
import { startOriginServer } from './common/origin';

describe('local distribution fallbacks', () => {
  let origin: OriginServer;
  let context: EmulateServiceContext;
  let distribution: ServiceEmulator;

  before(async () => {
    const emulators: ServiceEmulators = {};

    origin = await startOriginServer();
    context = createEmulateContext(emulators, options);

    const client = await createLocalBucket('FallbackFiles', emulators, options);

    await client.write('index.html', '<p>spa shell</p>');

    const service = createService('FallbackCdn', {
      defaultOrigin: bucketOrigin('FallbackFiles'),
      origins: [
        regularOrigin('localhost', {
          port: origin.port,
          path: 'api/*'
        })
      ],
      fallbacks: [
        {
          code: 404,
          location: '/index.html'
        },
        {
          code: 403,
          location: '/api/error.html'
        }
      ]
    });

    distribution = createDistribution(service, context);
  });

  after(async () => {
    await Promise.all([origin.close(), removeLocalBucket('FallbackFiles')]);
  });

  it('assert :: missing object serves the fallback with status 200', async () => {
    const response = await sendRequest(distribution, 'GET', '/deep/link');

    equal(response.status, 200);
    equal(response.headers?.['content-type'], 'text/html');
    equal(getBody(response), '<p>spa shell</p>');
  });

  it('assert :: origin error falls back to the default origin', async () => {
    const response = await sendRequest(distribution, 'GET', '/api/missing');

    equal(origin.lastRequest()?.url, '/api/missing');

    equal(response.status, 200);
    equal(getBody(response), '<p>spa shell</p>');
  });

  it('assert :: fallback location is requested from the origin whose path matches it', async () => {
    const response = await sendRequest(distribution, 'PUT', '/index.html', {
      body: '<p>denied</p>'
    });

    const received = origin.lastRequest();

    equal(received?.method, 'GET');
    equal(received?.url, '/api/error.html');

    equal(response.status, 200);
    equal(getBody(response), '<p>origin error page</p>');
  });

  it('assert :: status without fallback is returned as is', async () => {
    const response = await sendRequest(distribution, 'GET', '/api/moved');

    equal(response.status, 302);
    equal(response.headers?.location, 'https://elsewhere.example/target');
  });

  it('assert :: missing fallback location keeps the original error', async () => {
    const service = createService('BrokenFallbackCdn', {
      defaultOrigin: bucketOrigin('FallbackFiles'),
      fallbacks: [
        {
          code: 404,
          location: '/not-there.html'
        }
      ]
    });

    const response = await sendRequest(createDistribution(service, context), 'GET', '/nothing.html');

    equal(response.status, 404);
    match(getBody(response) ?? '', /<Key>nothing\.html<\/Key>/);
  });
});
