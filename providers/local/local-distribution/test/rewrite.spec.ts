import type { ServiceEmulator } from '@ez4/project/library';
import type { OriginServer } from './common/origin';

import { equal } from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import { createDistribution, createService, options, regularOrigin, rewriteRule, sendRequest } from './common/distribution';
import { createEmulateContext } from './common/storage';
import { startOriginServer } from './common/origin';

describe('local distribution rewrite rules', () => {
  let origin: OriginServer;
  let distribution: ServiceEmulator;

  before(async () => {
    origin = await startOriginServer();

    const { port } = origin;

    const service = createService('RewriteCdn', {
      defaultOrigin: regularOrigin('localhost', {
        port,
        location: '/root',
        rewrite: [
          rewriteRule('/legacy/*', '/modern/$1'),
          rewriteRule('/moved/*', '/new/$1', 301),
          rewriteRule('/docs/*', 'https://docs.example.com/$1'),
          rewriteRule('/pair/*/*', '/pairs/$1/$2'),
          rewriteRule('/*/shared', '/shared-target')
        ]
      }),
      origins: [
        regularOrigin('localhost', {
          port,
          path: 'app/*',
          location: '/app-origin',
          rewrite: [rewriteRule('/app/old/*', '/app/new/$1')]
        }),
        regularOrigin('localhost', {
          port,
          path: 'plain/*',
          location: '/plain-origin'
        })
      ]
    });

    distribution = createDistribution(service, createEmulateContext({}, options));
  });

  after(() => {
    return origin.close();
  });

  it('assert :: rewrite changes the path sent to the origin', async () => {
    const response = await sendRequest(distribution, 'GET', '/legacy/page');

    equal(response.status, 200);
    equal(origin.lastRequest()?.url, '/root/modern/page');
  });

  it('assert :: rewrite with status redirects back to the distribution', async () => {
    const requestCount = origin.requests.length;

    const response = await sendRequest(distribution, 'GET', '/moved/page', {
      query: { ref: 'a b' }
    });

    equal(response.status, 301);
    equal(response.headers?.location, 'http://localhost:3734/ez4-cdn-rewrite-cdn/new/page?ref=a%20b');
    equal(origin.requests.length, requestCount);
  });

  it('assert :: absolute target redirects with 302 by default', async () => {
    const response = await sendRequest(distribution, 'GET', '/docs/intro');

    equal(response.status, 302);
    equal(response.headers?.location, 'https://docs.example.com/intro');
  });

  it('assert :: only $0 and $1 are replaced in the target', async () => {
    await sendRequest(distribution, 'GET', '/pair/a/b');

    equal(origin.lastRequest()?.url, '/root/pairs/a/$2');
  });

  it('assert :: origin with rules gets the rules of every origin and keeps its behavior', async () => {
    await sendRequest(distribution, 'GET', '/app/x/shared');

    equal(origin.lastRequest()?.url, '/app-origin/shared-target');
  });

  it('assert :: origin with rules applies its own rules', async () => {
    await sendRequest(distribution, 'GET', '/app/old/x');

    equal(origin.lastRequest()?.url, '/app-origin/app/new/x');
  });

  it('assert :: origin without rules is not rewritten', async () => {
    await sendRequest(distribution, 'GET', '/plain/x/shared');

    equal(origin.lastRequest()?.url, '/plain-origin/plain/x/shared');
  });
});
