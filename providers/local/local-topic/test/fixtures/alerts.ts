import type { Environment, Service } from '@ez4/common';
import type { Topic } from '@ez4/topic';

// Services `ez4 test` loads for this package (see ez4.project.js), so the testers reach them as a project would.

export declare class AlertEvent implements Topic.Event {
  alertId: string;
  level: string;
}

export declare class AuditEvent implements Topic.Event {
  alertId: string;
}

export declare class AlertTopic extends Topic.Unordered<AlertEvent> {
  subscriptions: [
    Topic.UseSubscription<{
      handler: typeof handleAlert;
    }>
  ];

  services: {
    auditTopic: Environment.Service<AuditTopic>;
  };
}

export declare class AuditTopic extends Topic.Unordered<AuditEvent> {
  subscriptions: [
    Topic.UseSubscription<{
      handler: typeof handleAudit;
    }>
  ];

  services: {
    archiveTopic: Environment.Service<ArchiveTopic>;
  };
}

export declare class ArchiveTopic extends Topic.Unordered<AuditEvent> {
  subscriptions: [];
}

export async function handleAlert(request: Topic.Incoming<AlertEvent>, context: Service.Context<AlertTopic>) {
  await context.auditTopic.publishEvent({ alertId: request.event.alertId });
}

export async function handleAudit(request: Topic.Incoming<AuditEvent>, context: Service.Context<AuditTopic>) {
  await context.archiveTopic.publishEvent({ alertId: request.event.alertId });
}
