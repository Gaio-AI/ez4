import { deepEqual, doesNotThrow } from 'node:assert/strict';
import { describe, it } from 'node:test';

import { registerTriggers } from '@ez4/gateway/library';
import { buildMetadata } from '@ez4/project/library';

const sourceFile = './test/http/input/client-import-provider.ts';

describe('http import client in a provider', () => {
  registerTriggers();

  it('assert :: an import declaring its own typed client is still a valid service', () => {
    doesNotThrow(() => buildMetadata([sourceFile]));
  });

  it('assert :: provider links the import service by reference', () => {
    const { metadata } = buildMetadata([sourceFile]);

    const [route] = (metadata.LocalService as any).routes;

    deepEqual(route.handler.provider.services, {
      remoteApi: {
        reference: 'RemoteImport'
      }
    });
  });
});
