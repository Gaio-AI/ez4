import type { ServeOptions, ServiceEmulator } from '@ez4/project/library';
import type { TestContext } from 'node:test';
import type { OriginServer } from './common/origin';

import { deepEqual, equal } from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import { createDistribution, createService, getBody, options, regularOrigin, sendRequest } from './common/distribution';
import { createEmulateContext } from './common/storage';
import { startOriginServer } from './common/origin';

describe('local distribution regular origin', () => {
  let origin: OriginServer;
  let distribution: ServiceEmulator;

  const createApiDistribution = (port: number, serveOptions: ServeOptions = options) => {
    const service = createService('ApiCdn', {
      defaultOrigin: regularOrigin('localhost', {
        port,
        location: '/v1',
        headers: {
          ['X-Origin-Secret']: 'origin-secret'
        },
        cache: {
          ttl: 0,
          headers: ['CloudFront-Viewer-Country', 'origin']
        }
      }),
      origins: [
        regularOrigin('127.0.0.1', {
          port,
          path: 'plain/*'
        })
      ]
    });

    return createDistribution(service, createEmulateContext({}, serveOptions), serveOptions);
  };

  const captureFetch = (t: TestContext) => {
    const urls: string[] = [];

    t.mock.method(globalThis, 'fetch', async (input: string | URL | Request) => {
      urls.push(input.toString());

      return Promise.resolve(new Response('mocked', { status: 200 }));
    });

    return urls;
  };

  before(async () => {
    origin = await startOriginServer();
    distribution = createApiDistribution(origin.port);
  });

  after(() => {
    return origin.close();
  });

  it('assert :: request is proxied with method, path, query and body', async () => {
    const response = await sendRequest(distribution, 'POST', '/items', {
      headers: {
        ['content-type']: 'application/json'
      },
      query: {
        page: '2'
      },
      body: '{"name":"item"}'
    });

    const received = origin.lastRequest();

    equal(response.status, 200);
    deepEqual(JSON.parse(getBody(response) ?? ''), { method: 'POST', url: '/v1/items?page=2' });

    equal(received?.body, '{"name":"item"}');
    equal(received?.headers['content-type'], 'application/json');
  });

  it('assert :: origin status, headers and body are returned', async () => {
    const found = await sendRequest(distribution, 'GET', '/thing');
    const missing = await sendRequest(distribution, 'GET', '/missing');

    equal(found.status, 200);
    equal(found.headers?.['x-origin-server'], 'test');
    equal(found.headers?.['content-type'], 'application/json');

    equal(missing.status, 404);
    equal(getBody(missing), 'origin missing');
  });

  it('assert :: origin redirect is returned, not followed', async () => {
    const response = await sendRequest(distribution, 'GET', '/moved');

    equal(response.status, 302);
    equal(response.headers?.location, 'https://elsewhere.example/target');
  });

  it('assert :: viewer headers are forwarded except host, with the origin custom headers', async () => {
    await sendRequest(distribution, 'GET', '/thing', {
      headers: {
        host: 'cdn.localhost:3734',
        ['x-viewer']: 'viewer-value',
        ['x-origin-secret']: 'viewer-secret'
      }
    });

    const { headers } = origin.lastRequest() ?? {};

    equal(headers?.host, `localhost:${origin.port}`);
    equal(headers?.['x-viewer'], 'viewer-value');
    equal(headers?.['x-origin-secret'], 'origin-secret');
  });

  it('assert :: hop-by-hop viewer headers are not forwarded', async () => {
    const response = await sendRequest(distribution, 'POST', '/items', {
      headers: {
        connection: 'keep-alive',
        ['keep-alive']: 'timeout=5',
        ['transfer-encoding']: 'chunked',
        ['x-real-ip']: '198.51.100.7'
      },
      body: 'chunked body'
    });

    const { headers, body } = origin.lastRequest() ?? {};

    equal(response.status, 200);
    equal(body, 'chunked body');
    equal(headers?.['keep-alive'], undefined);
    equal(headers?.['x-real-ip'], undefined);
  });

  it('assert :: x-forwarded-for carries the local viewer', async () => {
    await sendRequest(distribution, 'GET', '/thing');

    equal(origin.lastRequest()?.headers['x-forwarded-for'], '127.0.0.1');

    await sendRequest(distribution, 'GET', '/thing', {
      headers: {
        ['x-forwarded-for']: '203.0.113.9'
      }
    });

    equal(origin.lastRequest()?.headers['x-forwarded-for'], '203.0.113.9,127.0.0.1');
  });

  it('assert :: viewer country is generated when the origin cache names it', async () => {
    await sendRequest(distribution, 'GET', '/thing');

    equal(origin.lastRequest()?.headers['cloudfront-viewer-country'], 'US');
  });

  it('assert :: generated viewer country replaces the one the viewer sends', async () => {
    await sendRequest(distribution, 'GET', '/thing', {
      headers: {
        ['cloudfront-viewer-country']: 'DE'
      }
    });

    equal(origin.lastRequest()?.headers['cloudfront-viewer-country'], 'US');
  });

  it('assert :: viewer country comes from the distribution local options', async () => {
    const localDistribution = createApiDistribution(origin.port, {
      ...options,
      localOptions: {
        api_cdn: {
          viewerCountry: 'BR'
        }
      }
    });

    await sendRequest(localDistribution, 'GET', '/thing');

    equal(origin.lastRequest()?.headers['cloudfront-viewer-country'], 'BR');
  });

  it('assert :: viewer country is not generated when the origin cache does not name it', async () => {
    await sendRequest(distribution, 'GET', '/plain/thing');

    equal(origin.lastRequest()?.url, '/plain/thing');
    equal(origin.lastRequest()?.headers['cloudfront-viewer-country'], undefined);

    await sendRequest(distribution, 'GET', '/plain/thing', {
      headers: {
        ['cloudfront-viewer-country']: 'DE'
      }
    });

    equal(origin.lastRequest()?.headers['cloudfront-viewer-country'], 'DE');
  });

  it('assert :: unreachable origin answers 502', async () => {
    const unreachable = await startOriginServer();

    await unreachable.close();

    const response = await sendRequest(createApiDistribution(unreachable.port), 'GET', '/thing');

    equal(response.status, 502);
  });

  it('assert :: remote domain uses the origin protocol and port', async (t) => {
    const urls = captureFetch(t);

    const secure = createService('SecureCdn', {
      defaultOrigin: regularOrigin('api.ez4.dev', { port: 8443, location: '/v1' })
    });

    const plain = createService('PlainCdn', {
      defaultOrigin: regularOrigin('api.ez4.dev', { protocol: 'http' })
    });

    const context = createEmulateContext({}, options);

    await sendRequest(createDistribution(secure, context), 'GET', '/items', { query: { page: '2' } });
    await sendRequest(createDistribution(plain, context), 'GET', '/items');

    deepEqual(urls, ['https://api.ez4.dev:8443/v1/items?page=2', 'http://api.ez4.dev/items']);
  });

  it('assert :: local domain goes over plain http', async (t) => {
    const urls = captureFetch(t);

    const serveHost = createService('ServeHostCdn', {
      defaultOrigin: regularOrigin('localhost:3734', { protocol: 'https', location: '/ez4-cdn-api' })
    });

    const loopback = createService('LoopbackCdn', {
      defaultOrigin: regularOrigin('127.0.0.1', { port: 8080 })
    });

    const context = createEmulateContext({}, options);

    await sendRequest(createDistribution(serveHost, context), 'GET', '/items');
    await sendRequest(createDistribution(loopback, context), 'GET', '/items');

    deepEqual(urls, ['http://localhost:3734/ez4-cdn-api/items', 'http://127.0.0.1:8080/items']);
  });
});
