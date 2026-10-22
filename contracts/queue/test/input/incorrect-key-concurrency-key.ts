import type { Queue } from '@ez4/queue';

interface TestMessage extends Queue.Message {
  id: string;
  note?: string;
}

export declare class TestQueue extends Queue.Unordered<TestMessage> {
  subscriptions: [
    // An optional field can't name who the limit is for.
    Queue.UseSubscription<{
      handler: typeof testHandler;
      keyConcurrency: {
        key: 'note';
        max: 1;
      };
    }>
  ];
}

export function testHandler(_request: Queue.Incoming<TestMessage>) {}
