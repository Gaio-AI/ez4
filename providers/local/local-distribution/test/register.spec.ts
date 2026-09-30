import type { ServiceEmulators } from './common/storage';

import { deepEqual, equal, ok } from 'node:assert/strict';
import { after, describe, it } from 'node:test';

import { getCdnServicesMetadata } from '@ez4/distribution/library';
import { buildReflection, triggerAllAsync } from '@ez4/project/library';
import { getBucketServicesMetadata } from '@ez4/storage/library';
import { registerTriggers } from '@ez4/local-distribution';

import { bucketOrigin, createService, getBody, options, sendRequest } from './common/distribution';
import { createEmulateContext, createLocalBucket, removeLocalBucket } from './common/storage';

describe('local distribution registration', () => {
  registerTriggers();

  after(() => {
    return removeLocalBucket('ProjectBucket');
  });

  it('assert :: cdn service gets a distribution emulator', async () => {
    const service = createService('SiteCdn', {
      defaultOrigin: bucketOrigin('SiteBucket')
    });

    const emulator = await triggerAllAsync('emulator:getServices', (handler) => {
      return handler({
        context: createEmulateContext({}, options),
        service,
        options
      });
    });

    ok(emulator?.requestHandler);

    equal(emulator.type, 'Distribution');
    equal(emulator.name, 'SiteCdn');
    equal(emulator.identifier, 'ez4-cdn-site-cdn');
  });

  it('assert :: project distribution loads and serves its bucket', async () => {
    const reflection = buildReflection(['./test/input/project.ts']);

    const buckets = getBucketServicesMetadata(reflection);
    const distributions = getCdnServicesMetadata(reflection);

    deepEqual([...buckets.errors, ...distributions.errors], []);

    const emulators: ServiceEmulators = {};
    const context = createEmulateContext(emulators, options);

    const client = await createLocalBucket(buckets.services.ProjectBucket.name, emulators, options);

    await client.write('index.html', '<p>project home</p>');

    const emulator = await triggerAllAsync('emulator:getServices', (handler) => {
      return handler({
        service: distributions.services.ProjectCdn,
        context,
        options
      });
    });

    ok(emulator?.requestHandler);

    const home = await sendRequest(emulator, 'GET', '/');
    const deepLink = await sendRequest(emulator, 'GET', '/some/deep/link');

    equal(home.status, 200);
    equal(getBody(home), '<p>project home</p>');

    equal(deepLink.status, 200);
    equal(getBody(deepLink), '<p>project home</p>');
  });
});
