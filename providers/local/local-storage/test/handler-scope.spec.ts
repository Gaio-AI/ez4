import type { BucketEvent, BucketService } from '@ez4/storage/library';
import type { EmulateServiceContext, ServeOptions } from '@ez4/project/library';
import type { Bucket } from '@ez4/storage';
import type { ObservedScope } from './fixtures/scope-probe';

import { equal } from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import { Runtime } from '@ez4/common';

import { processLambdaEvent } from '../src/handlers/lambda';

const options = {
  prefix: 'ez4',
  projectName: 'scope',
  branchName: '',
  serviceHost: 'localhost:0',
  version: 1,
  localOptions: {},
  testOptions: {}
} as ServeOptions;

const context = {
  makeClients: () => ({}),
  makeClient: () => undefined
} as unknown as EmulateServiceContext;

const service = {
  type: '@ez4/bucket',
  name: 'scopeBucket',
  services: {},
  variables: {}
} as unknown as BucketService;

const event = {
  path: 'test/fixtures/scope-probe.ts',
  handler: {
    name: 'probeScopeLater',
    file: 'test/fixtures/scope-probe.ts',
    position: [1, 1]
  }
} as unknown as BucketEvent;

const getObjectEvent = (objectKey: string) => {
  return {
    eventType: 'create',
    bucketName: 'scope-bucket',
    objectKey,
    objectSize: 1
  } as unknown as Bucket.ObjectEvent;
};

const observeScopes = (count: number) => {
  const observed: ObservedScope[] = [];

  return new Promise<ObservedScope[]>((resolve) => {
    globalThis.observeScope = (entry) => {
      observed.push(entry);

      if (observed.length === count) {
        resolve(observed);
      }
    };
  });
};

describe('local storage handler scope', () => {
  afterEach(() => {
    globalThis.observeScope = undefined;
    Runtime.clearScope();
  });

  it('assert :: concurrent object events keep their own scope', async () => {
    const observed = observeScopes(2);

    await Promise.all([
      processLambdaEvent(service, options, context, event, getObjectEvent('a.txt')),
      processLambdaEvent(service, options, context, event, getObjectEvent('b.txt'))
    ]);

    for (const { traceId, scope } of await observed) {
      equal(scope?.traceId, traceId);
    }

    equal(Runtime.getScope(), undefined);
  });
});
