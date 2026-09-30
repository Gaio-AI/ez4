import type { OriginServer } from './common/origin';

import { equal } from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import { createDistribution, createService, options, regularOrigin, sendRequest } from './common/distribution';
import { createEmulateContext } from './common/storage';
import { startOriginServer } from './common/origin';

describe('local distribution disabled', () => {
  let origin: OriginServer;

  before(async () => {
    origin = await startOriginServer();
  });

  after(() => {
    return origin.close();
  });

  it('assert :: disabled distribution answers 403 without reaching the origin', async () => {
    const service = createService('DisabledCdn', {
      disabled: true,
      defaultOrigin: regularOrigin('localhost', {
        port: origin.port
      })
    });

    const distribution = createDistribution(service, createEmulateContext({}, options));

    const root = await sendRequest(distribution, 'GET', '/');
    const page = await sendRequest(distribution, 'POST', '/page');

    equal(root.status, 403);
    equal(page.status, 403);

    equal(origin.requests.length, 0);
  });
});
