import type { Environment, Service } from '@ez4/common';
import type { Cron } from '@ez4/scheduler';

// Services `ez4 test` loads for this package (see ez4.project.js), so the testers reach them as a project would.

export declare class ReportEvent implements Cron.Event {
  reportId: string;
  format: string;
}

export declare class FollowUpEvent implements Cron.Event {
  reportId: string;
}

export declare class ReportCron extends Cron.Service<ReportEvent> {
  expression: 'dynamic';

  target: Cron.UseTarget<{
    handler: typeof runReport;
  }>;

  services: {
    followUpCron: Environment.Service<FollowUpCron>;
  };
}

export declare class FollowUpCron extends Cron.Service<FollowUpEvent> {
  expression: 'dynamic';

  target: Cron.UseTarget<{
    handler: typeof runFollowUp;
  }>;

  services: {
    reportCron: Environment.Service<ReportCron>;
  };
}

export declare class PurgeCron extends Cron.Service {
  expression: 'rate(1 hour)';

  target: Cron.UseTarget<{
    handler: typeof runPurge;
  }>;

  services: {
    reportCron: Environment.Service<ReportCron>;
  };
}

// The local scheduler keeps `ez4 test` running until a created event is due, so it's due soon.
export const EVENT_DELAY = 100;

export async function runReport(request: Cron.Incoming<ReportEvent>, context: Service.Context<ReportCron>) {
  const { reportId } = request.event;

  await context.followUpCron.createEvent(`follow-up-${reportId}`, {
    date: new Date(Date.now() + EVENT_DELAY),
    event: {
      reportId
    }
  });
}

export async function runFollowUp(request: Cron.Incoming<FollowUpEvent>, context: Service.Context<FollowUpCron>) {
  await context.reportCron.getEvent(`report-${request.event.reportId}`);
}

export async function runPurge(_request: Cron.Incoming<null>, context: Service.Context<PurgeCron>) {
  await context.reportCron.createEvent('purge-report', {
    date: new Date(Date.now() + EVENT_DELAY),
    event: {
      reportId: 'purge',
      format: 'csv'
    }
  });
}
