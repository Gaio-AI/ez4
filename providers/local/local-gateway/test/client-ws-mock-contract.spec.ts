import type { WsService } from '@ez4/gateway/library';

import { describe, it, mock } from 'node:test';
import { deepEqual, equal, ok } from 'node:assert/strict';

import { createWsClientMock } from '../src/client/ws/mock';
import { WsTester } from '../src/service/tester/ws';

const wsService = {
  type: '@ez4/ws',
  name: 'contractWs',
  services: {},
  variables: {},
  defaults: {
    preferences: {
      namingStyle: 'snake'
    }
  },
  message: {},
  schema: {
    type: 'object',
    properties: {
      eventType: {
        type: 'string'
      }
    }
  }
} as unknown as WsService;

describe('local ws client mock contract', () => {
  it('assert :: deliver the message as the connection receives it', async () => {
    const client = createWsClientMock<any>('contractWs', wsService);

    await client.sendMessage('connection-1', { eventType: 'refresh', extra: 'dropped by the schema' });

    deepEqual(client.delivered, [
      {
        connectionId: 'connection-1',
        message: {
          event_type: 'refresh'
        }
      }
    ]);
  });

  it('assert :: tester mock survives restoreAll from another spec', async () => {
    const client = WsTester.getClientMock<any>('anyWs');

    await client.sendMessage('connection-1', { eventType: 'a' });

    mock.restoreAll();

    await client.sendMessage('connection-1', { eventType: 'b' });

    ok(client.sendMessage.mock);
    equal(client.sendMessage.mock.callCount(), 2);
  });
});
