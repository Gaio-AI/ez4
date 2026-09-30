import type { EmulatorConnection } from '@ez4/project/library';
import type { ObjectSchema } from '@ez4/schema';

import { deepEqual } from 'node:assert/strict';
import { describe, it } from 'node:test';

import { SchemaType } from '@ez4/schema';

import { createWsServiceClient } from '../src/client/ws/service';

const messageSchema: ObjectSchema = {
  type: SchemaType.Object,
  properties: {
    eventType: {
      type: SchemaType.String
    }
  }
};

const getConnection = (live: boolean) => {
  const written: string[] = [];

  const connection: EmulatorConnection = {
    id: 'connection-1',
    live,
    write: (data) => {
      written.push(data.toString());
    },
    close: () => {}
  };

  return { connection, written };
};

describe('local ws client', () => {
  it('assert :: send to a connection that does not exist', async () => {
    const client = createWsServiceClient('ws', {
      allConnections: {},
      messageSchema
    });

    await client.sendMessage('connection-1', { eventType: 'refresh' });
  });

  it('assert :: send to a connection that is closed', async () => {
    const { connection, written } = getConnection(false);

    const client = createWsServiceClient('ws', {
      allConnections: { [connection.id]: connection },
      messageSchema
    });

    await client.sendMessage(connection.id, { eventType: 'refresh' });

    deepEqual(written, []);
  });

  it('assert :: send to a live connection', async () => {
    const { connection, written } = getConnection(true);

    const client = createWsServiceClient('ws', {
      allConnections: { [connection.id]: connection },
      messageSchema
    });

    await client.sendMessage(connection.id, { eventType: 'refresh' });

    deepEqual(written, ['{"eventType":"refresh"}']);
  });
});
