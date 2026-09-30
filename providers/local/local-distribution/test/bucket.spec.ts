import type { ServiceEmulator } from '@ez4/project/library';
import type { Client } from '@ez4/storage';
import type { ServiceEmulators } from './common/storage';

import { equal, match } from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import { bucketOrigin, createDistribution, createService, getBody, options, sendRequest } from './common/distribution';
import { createEmulateContext, createLocalBucket, removeLocalBucket } from './common/storage';

// Minimal valid PNG (1x1 transparent pixel).
const PNG_CONTENT = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00,
  0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01,
  0x00, 0x00, 0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82
]);

describe('local distribution bucket origin', () => {
  let client: Client;
  let distribution: ServiceEmulator;

  before(async () => {
    const emulators: ServiceEmulators = {};

    client = await createLocalBucket('BucketOriginFiles', emulators, options);

    await Promise.all([
      client.write('index.html', '<p>bucket home</p>'),
      client.write('app/main.js', 'console.log(1);'),
      client.write('hello world.txt', 'spaced key'),
      client.write('site/docs/page.html', '<p>docs page</p>'),
      client.write('images/logo', PNG_CONTENT),
      client.write('reports/summary.png', 'plain summary', { contentType: 'text/plain' })
    ]);

    const service = createService('BucketCdn', {
      defaultOrigin: bucketOrigin('BucketOriginFiles'),
      origins: [
        bucketOrigin('BucketOriginFiles', {
          location: '/site',
          path: 'docs/*'
        })
      ]
    });

    distribution = createDistribution(service, createEmulateContext(emulators, options));
  });

  after(() => {
    return removeLocalBucket('BucketOriginFiles');
  });

  it('assert :: object is served with the content type of its extension', async () => {
    const script = await sendRequest(distribution, 'GET', '/app/main.js');
    const page = await sendRequest(distribution, 'GET', '/index.html');

    equal(script.status, 200);
    equal(script.headers?.['content-type'], 'application/javascript');
    equal(getBody(script), 'console.log(1);');

    equal(page.status, 200);
    equal(page.headers?.['content-type'], 'text/html');
    equal(getBody(page), '<p>bucket home</p>');
  });

  it('assert :: object without extension gets the default content type of S3', async () => {
    const response = await sendRequest(distribution, 'GET', '/images/logo');

    equal(response.status, 200);
    equal(response.headers?.['content-type'], 'binary/octet-stream');
  });

  it('assert :: object is served with the content type it was written with', async () => {
    const response = await sendRequest(distribution, 'GET', '/reports/summary.png');

    equal(response.status, 200);
    equal(response.headers?.['content-type'], 'text/plain');
  });

  it('assert :: origin location prefixes the object key', async () => {
    const response = await sendRequest(distribution, 'GET', '/docs/page.html');

    equal(response.status, 200);
    equal(getBody(response), '<p>docs page</p>');
  });

  it('assert :: percent-encoded path is decoded into the object key', async () => {
    const response = await sendRequest(distribution, 'GET', '/hello%20world.txt');

    equal(response.status, 200);
    equal(response.headers?.['content-type'], 'text/plain');
    equal(getBody(response), 'spaced key');
  });

  it('assert :: missing object answers 404 (the distribution can list the bucket)', async () => {
    const response = await sendRequest(distribution, 'GET', '/missing.html');

    equal(response.status, 404);
    equal(response.headers?.['content-type'], 'application/xml');
    match(getBody(response) ?? '', /<Code>NoSuchKey<\/Code>/);
    match(getBody(response) ?? '', /<Key>missing\.html<\/Key>/);
  });

  it('assert :: folder-like key answers 404', async () => {
    const folder = await sendRequest(distribution, 'GET', '/app');
    const folderSlash = await sendRequest(distribution, 'GET', '/app/');

    equal(folder.status, 404);
    equal(folderSlash.status, 404);
  });

  it('assert :: malformed percent-encoding answers 400', async () => {
    const response = await sendRequest(distribution, 'GET', '/bad%E0%A4%A');

    equal(response.status, 400);
    match(getBody(response) ?? '', /<Code>InvalidURI<\/Code>/);
  });

  it('assert :: head answers the object headers without a body', async () => {
    const response = await sendRequest(distribution, 'HEAD', '/index.html');

    equal(response.status, 200);
    equal(response.headers?.['content-type'], 'text/html');
    equal(response.headers?.['content-length'], '18');
    equal(response.body, undefined);
  });

  it('assert :: write methods answer 403 and keep the object', async () => {
    const response = await sendRequest(distribution, 'PUT', '/index.html', {
      body: '<p>overwritten</p>'
    });

    equal(response.status, 403);
    match(getBody(response) ?? '', /<Code>AccessDenied<\/Code>/);

    equal((await client.read('index.html')).toString(), '<p>bucket home</p>');
  });
});
