import type { ServiceEmulator } from '@ez4/project/library';
import type { OriginServer } from './common/origin';

import { equal } from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import { createDistribution, createService, options, regularOrigin, sendRequest } from './common/distribution';
import { createEmulateContext } from './common/storage';
import { startOriginServer } from './common/origin';

describe('local distribution routing', () => {
  let origin: OriginServer;
  let distribution: ServiceEmulator;

  before(async () => {
    origin = await startOriginServer();

    const { port } = origin;

    const service = createService('RoutingCdn', {
      defaultIndex: 'index.html',
      defaultOrigin: regularOrigin('localhost', { port, location: '/default' }),
      origins: [
        regularOrigin('localhost', { port, location: '/first', path: 'api/v?/*' }),
        regularOrigin('localhost', { port, location: '/second', path: '/api/*' }),
        regularOrigin('localhost', { port, location: '/third', path: '*.json' })
      ]
    });

    distribution = createDistribution(service, createEmulateContext({}, options));
  });

  after(() => {
    return origin.close();
  });

  const getOriginUrl = async (path: string, query?: Record<string, string>) => {
    const response = await sendRequest(distribution, 'GET', path, { query });

    equal(response.status, 200);

    return origin.lastRequest()?.url;
  };

  it('assert :: first origin whose path matches wins', async () => {
    equal(await getOriginUrl('/api/v1/users'), '/first/api/v1/users');
  });

  it('assert :: path wildcard ? matches exactly one character', async () => {
    equal(await getOriginUrl('/api/v10/users'), '/second/api/v10/users');
  });

  it('assert :: path wildcard * matches across path segments', async () => {
    equal(await getOriginUrl('/data/a/b.json'), '/third/data/a/b.json');
  });

  it('assert :: path patterns are case-sensitive', async () => {
    equal(await getOriginUrl('/API/v1/users'), '/default/API/v1/users');
  });

  it('assert :: path patterns ignore the query string', async () => {
    equal(await getOriginUrl('/other', { file: 'a.json' }), '/default/other?file=a.json');
  });

  it('assert :: unmatched path goes to the default origin', async () => {
    equal(await getOriginUrl('/other'), '/default/other');
  });

  it('assert :: default index is served for the root', async () => {
    equal(await getOriginUrl('/'), '/default/index.html');
  });

  it('assert :: default index is not served for a subdirectory', async () => {
    equal(await getOriginUrl('/docs/'), '/default/docs/');
  });
});
