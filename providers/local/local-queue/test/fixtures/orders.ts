import type { Environment, Service } from '@ez4/common';
import type { Queue } from '@ez4/queue';

// Services `ez4 test` loads for this package (see ez4.project.js), so the testers reach them as a project would.

export declare class OrderMessage implements Queue.Message {
  orderId: string;
  customer: string;
  note?: string;
}

export declare class AuditMessage implements Queue.Message {
  orderId: string;
  action: string;
}

export declare class NotifyMessage implements Queue.Message {
  orderId: string;
}

export declare class OrderQueue extends Queue.Unordered<OrderMessage> {
  subscriptions: [
    Queue.UseSubscription<{
      handler: typeof processOrder;
    }>
  ];

  deadLetter: Queue.UseDeadLetter<{
    maxAttempts: 5;
  }>;

  services: {
    auditQueue: Environment.Service<AuditQueue>;
    notifyQueue: Environment.Service<NotifyQueue>;
  };
}

export declare class AuditQueue extends Queue.Unordered<AuditMessage> {
  subscriptions: [];
}

export declare class NotifyQueue extends Queue.Unordered<NotifyMessage> {
  subscriptions: [];
}

export async function processOrder(request: Queue.Incoming<OrderMessage>, context: Service.Context<OrderQueue>) {
  const { auditQueue, notifyQueue } = context;
  const { orderId } = request.message;

  await auditQueue.sendMessage({ orderId, action: 'placed' });
  await notifyQueue.sendMessage({ orderId });
}
