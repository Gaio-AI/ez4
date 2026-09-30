import type { AlertTopic, ArchiveTopic, AuditTopic } from './fixtures/alerts';

import { deepEqual, equal, match, rejects } from 'node:assert/strict';
import { describe, it } from 'node:test';

import { MalformedEventError } from '@ez4/topic/utils';

import { TopicTester } from '../src/service/tester';
import { handleAlert } from './fixtures/alerts';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// Gives the deliveries the local topic client schedules some turns to run.
const waitFor = async (condition: () => boolean, turns = 1000) => {
  for (let turn = 0; turn < turns && !condition(); turn++) {
    await new Promise((resolve) => setImmediate(resolve));
  }
};

describe('local topic tester invoke', () => {
  it('assert :: publish an event through the topic emulator', async () => {
    const auditTopic = TopicTester.getClientMock<AuditTopic>('AuditTopic');

    const response = await TopicTester.publish<AlertTopic>(
      'AlertTopic',
      {
        alertId: 'publish-1',
        level: 'high'
      },
      {
        services: {
          AuditTopic: auditTopic
        }
      }
    );

    equal(response.status, 201);

    // The Lambda subscription ran in the async context of the publish, with its overrides.
    deepEqual(auditTopic.delivered, [{ alertId: 'publish-1' }]);
  });

  it('assert :: overrides reach a subscription the local client delivers to', async () => {
    const archiveTopic = TopicTester.getClientMock<ArchiveTopic>('ArchiveTopic');

    await TopicTester.publish<AlertTopic>(
      'AlertTopic',
      {
        alertId: 'chain-1',
        level: 'low'
      },
      {
        services: {
          ArchiveTopic: archiveTopic
        }
      }
    );

    // The real audit topic client delivers after the publish resolves, still in its async context.
    await waitFor(() => archiveTopic.delivered.length > 0);

    deepEqual(archiveTopic.delivered, [{ alertId: 'chain-1' }]);
  });

  it('assert :: publish an event the topic refuses', async () => {
    // @ts-expect-error The event type refuses it as well.
    const response = await TopicTester.publish<AlertTopic>('AlertTopic', { alertId: 'publish-2' });

    equal(response.status, 400);
    equal(JSON.parse(`${response.body}`).message, 'Malformed topic event payload.');
  });

  it('assert :: incoming request of an event', async () => {
    const request = await TopicTester.incoming<AlertTopic>('AlertTopic', {
      alertId: 'incoming-1',
      level: 'high',
      // @ts-expect-error Not in the event type, and the schema drops it.
      extra: 'dropped'
    });

    deepEqual(request.event, { alertId: 'incoming-1', level: 'high' });

    match(request.requestId, UUID_PATTERN);
    match(request.traceId ?? '', UUID_PATTERN);

    const { requestId, traceId } = await TopicTester.incoming<AlertTopic>(
      'AlertTopic',
      {
        alertId: 'incoming-2',
        level: 'low'
      },
      {
        requestId: 'request-1',
        traceId: 'trace-1'
      }
    );

    deepEqual({ requestId, traceId }, { requestId: 'request-1', traceId: 'trace-1' });
  });

  it('assert :: incoming request of an event the runtime refuses', async () => {
    await rejects(
      // @ts-expect-error The event type refuses it as well.
      TopicTester.incoming<AlertTopic>('AlertTopic', { alertId: 'invalid-1', level: null }),
      MalformedEventError
    );

    await rejects(TopicTester.incoming('UnknownTopic', {}), /UnknownTopic/);
  });

  it('assert :: call a handler with its incoming request and context', async () => {
    const auditTopic = TopicTester.getClientMock<AuditTopic>('AuditTopic');

    const request = await TopicTester.incoming<AlertTopic>('AlertTopic', { alertId: 'direct-1', level: 'high' });
    const context = TopicTester.getContext<AlertTopic>('AlertTopic', { auditTopic });

    await handleAlert(request, context);

    deepEqual(auditTopic.delivered, [{ alertId: 'direct-1' }]);
  });
});
