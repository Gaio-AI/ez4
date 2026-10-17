import type { Queue } from '@ez4/queue';

interface TestMessage extends Queue.Message {}

export declare class TestQueue extends Queue.Unordered<TestMessage> {
  // @ts-expect-error The subscription acknowledge isn't expected.
  subscriptions: [TestSubscription];
}

declare class TestSubscription implements Queue.Subscription<TestMessage> {
  handler: typeof testHandler;

  // @ts-expect-error Only 'record' and 'batch' are expected.
  acknowledge: 'message';
}

export function testHandler(_request: Queue.Incoming<TestMessage>) {}
