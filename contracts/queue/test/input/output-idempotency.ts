import type { Queue } from '@ez4/queue';

interface TestMessage extends Queue.Message {
  eventId: string;
  jobId: string;
  contactId: number;
  note?: string;
}

export declare class TestQueue extends Queue.Unordered<TestMessage> {
  subscriptions: [
    // One field names the unit of work.
    Queue.UseSubscription<{
      handler: typeof testHandler;
      idempotency: {
        key: 'eventId';
        ttl: 604800;
      };
    }>,

    // Two fields name it together.
    Queue.UseSubscription<{
      handler: typeof otherHandler;
      idempotency: Queue.UseIdempotency<{
        key: ['jobId', 'contactId'];
        ttl: 3600;
      }>;
    }>,

    // Subscription reference.
    TestSubscription
  ];
}

// A subscription to a queue of another project keeps its own keys.
export declare class TestImportQueue extends Queue.Import<TestQueue> {
  project: 'name from project in ez4.project.js';

  subscriptions: [
    Queue.UseSubscription<{
      handler: typeof testHandler;
      idempotency: {
        key: 'eventId';
        ttl: 60;
      };
    }>
  ];
}

declare class TestIdempotency implements Queue.Idempotency<TestMessage> {
  key: 'jobId';
  ttl: 86400;
}

declare class TestSubscription implements Queue.Subscription<TestMessage> {
  handler: typeof thirdHandler;
  idempotency: TestIdempotency;
}

export function testHandler(_request: Queue.Incoming<TestMessage>) {}

export function otherHandler(_request: Queue.Incoming<TestMessage>) {}

export function thirdHandler(_request: Queue.Incoming<TestMessage>) {}
