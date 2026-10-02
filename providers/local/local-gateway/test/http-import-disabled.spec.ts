import type { HttpImport } from '@ez4/gateway/library';
import type { HttpClientRequest } from '@ez4/gateway';
import type { ServeOptions } from '@ez4/project/library';

import { equal, rejects } from 'node:assert/strict';
import { describe, it } from 'node:test';

import { HttpError } from '@ez4/gateway';

import { registerHttpRemoteService } from '../src/provider/http/remote';
import { emulateContext, serveOptions } from './common/emulator';
import { startServer } from './common/server';

type TestClient = Record<string, (request: HttpClientRequest) => Promise<unknown>>;

const service = {
  type: '@ez4/import:http',
  name: 'OwnerApi',
  reference: 'Api',
  project: '@test/owner',
  services: {},
  variables: {},
  routes: [
    {
      name: 'getItem',
      path: 'GET /items',
      handler: {
        response: {
          status: 204
        }
      }
    }
  ]
} as unknown as HttpImport;

describe('local gateway disabled import', () => {
  it('assert :: a disabled import client fails every operation with 503', async (t) => {
    const owner = await startServer(() => ({ status: 204 }));

    t.after(() => owner.close());

    const options = {
      ...serveOptions,
      imports: {
        '@test/owner': {
          prefix: 'ez4',
          projectName: 'owner',
          branchName: '',
          serviceHost: owner.host,
          disabled: true
        }
      }
    } as ServeOptions;

    const client = registerHttpRemoteService(service, options, emulateContext).exportHandler() as TestClient;

    await rejects(client.getItem!({}), (error) => {
      return (
        error instanceof HttpError &&
        error.status === 503 &&
        error.message === `Imported service '@test/owner' is disabled in this deployment.`
      );
    });

    equal(owner.received.length, 0);
  });
});
