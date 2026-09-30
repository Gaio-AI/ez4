import type { FollowUpEvent, PurgeCron, ReportCron, ReportEvent } from './fixtures/reports';

import { deepEqual, equal, match, rejects } from 'node:assert/strict';
import { describe, it } from 'node:test';

import { MalformedEventError } from '@ez4/scheduler/utils';

import { CronTester } from '../src/service/tester';
import { EVENT_DELAY, runReport } from './fixtures/reports';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const waitFor = async (condition: () => boolean, timeout: number) => {
  const deadline = Date.now() + timeout;

  while (!condition() && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
};

describe('local scheduler tester invoke', () => {
  it('assert :: trigger a schedule with its event', async () => {
    const followUpCron = CronTester.getClientMock<FollowUpEvent>('FollowUpCron');

    const response = await CronTester.trigger<ReportCron>(
      'ReportCron',
      {
        reportId: 'trigger-1',
        format: 'pdf'
      },
      {
        services: {
          FollowUpCron: followUpCron
        }
      }
    );

    equal(response.status, 201);

    // The target ran in the async context of the trigger, with its overrides.
    deepEqual(
      followUpCron.createEvent.mock.calls.map((call) => call.arguments[1].event),
      [{ reportId: 'trigger-1' }]
    );
  });

  it('assert :: overrides reach the target of an event the trigger creates', async () => {
    const reportCron = CronTester.getClientMock<ReportEvent>('ReportCron');

    await CronTester.trigger<ReportCron>(
      'ReportCron',
      {
        reportId: 'chain-1',
        format: 'pdf'
      },
      {
        services: {
          ReportCron: reportCron
        }
      }
    );

    // The real follow-up scheduler runs the event when it's due, still in the async context of the trigger.
    await waitFor(() => reportCron.getEvent.mock.callCount() > 0, EVENT_DELAY * 20);

    deepEqual(
      reportCron.getEvent.mock.calls.map((call) => call.arguments),
      [['report-chain-1']]
    );
  });

  it('assert :: trigger a schedule without an event', async () => {
    const reportCron = CronTester.getClientMock<ReportEvent>('ReportCron');

    const response = await CronTester.trigger<PurgeCron>('PurgeCron', null, {
      services: {
        ReportCron: reportCron
      }
    });

    equal(response.status, 201);
    equal(reportCron.createEvent.mock.callCount(), 1);
  });

  it('assert :: trigger a schedule with an event it refuses', async () => {
    // @ts-expect-error The event type refuses it as well.
    const response = await CronTester.trigger<ReportCron>('ReportCron', { reportId: 'trigger-2' });

    equal(response.status, 400);
    equal(JSON.parse(`${response.body}`).message, 'Malformed scheduler event payload.');
  });

  it('assert :: incoming request of a schedule event', async () => {
    const request = await CronTester.incoming<ReportCron>('ReportCron', {
      reportId: 'incoming-1',
      format: 'pdf',
      // @ts-expect-error Not in the event type, and the schema drops it.
      extra: 'dropped'
    });

    deepEqual(request.event, { reportId: 'incoming-1', format: 'pdf' });

    match(request.requestId, UUID_PATTERN);
    match(request.traceId ?? '', UUID_PATTERN);

    const { requestId, traceId, event } = await CronTester.incoming<PurgeCron>('PurgeCron', null, {
      requestId: 'request-1',
      traceId: 'trace-1'
    });

    // Without an event schema the runtime gives the target no event.
    deepEqual({ requestId, traceId, event }, { requestId: 'request-1', traceId: 'trace-1', event: null });
  });

  it('assert :: incoming request of an event the runtime refuses', async () => {
    await rejects(
      // @ts-expect-error The event type refuses it as well.
      CronTester.incoming<ReportCron>('ReportCron', { reportId: 'invalid-1', format: null }),
      MalformedEventError
    );

    await rejects(CronTester.incoming('UnknownCron', null), /UnknownCron/);
  });

  it('assert :: call a handler with its incoming request and context', async () => {
    const followUpCron = CronTester.getClientMock<FollowUpEvent>('FollowUpCron');

    const request = await CronTester.incoming<ReportCron>('ReportCron', { reportId: 'direct-1', format: 'pdf' });
    const context = CronTester.getContext<ReportCron>('ReportCron', { followUpCron });

    await runReport(request, context);

    equal(followUpCron.createEvent.mock.callCount(), 1);
  });
});
