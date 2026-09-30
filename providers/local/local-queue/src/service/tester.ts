import type { Client, Queue, SendOptions, StandardSendOptions } from '@ez4/queue';
import type { Service } from '@ez4/common';
import type { Mock } from 'node:test';

import { getJsonMessage, resolveValidation } from '@ez4/queue/utils';
import { isQueueImport, isQueueService } from '@ez4/queue/library';
import { Tester } from '@ez4/project/library';
import { getRandomUUID } from '@ez4/utils';

import { mock } from 'node:test';

import { createClientMock } from '../client/mock';
import { getLocalQueueHandle } from '../utils/handle';
import { getMessageDelayHeaders, getOutgoingMessage } from '../utils/message';
import { Defaults } from '../utils/defaults';

// A tracker of its own, so `mock.restoreAll()` in another spec of the same process leaves these mocks alone.
const tracker = new (mock.constructor as new () => typeof mock)();

export namespace QueueTester {
  export type ClientMock<T extends Queue.Message, U extends Queue.Mode> = Client<T, U> & {
    receiveMessage: Mock<Client<T, U>['receiveMessage']>;
    sendMessage: Mock<Client<T, U>['sendMessage']>;

    /**
     * Messages as the consumer receives them: validated and trimmed by the queue schema.
     * Empty when the tester doesn't know the queue.
     */
    readonly delivered: T[];
  };

  export type ClientMode<T extends Queue.Service<any, Queue.Mode>> = T extends { fairMode: never }
    ? { fifoMode: true }
    : { fairMode: true };

  export type Incoming<T extends Queue.Message> = Queue.Incoming<T> & {
    retry: Mock<Queue.Incoming<T>['retry']>;
  };

  export type IncomingOverrides = Partial<
    Pick<Queue.Incoming<Queue.Message>, 'requestId' | 'traceId' | 'attempt' | 'maxAttempts' | 'retry'>
  >;

  export const getClient = <T extends Queue.Service<any, Queue.Mode>>(resourceName: string) => {
    return Tester.getServiceClient(resourceName) as Client<T['schema'], ClientMode<T>>;
  };

  export const getClientMock = <T extends Queue.Service<any, Queue.Mode>>(resourceName: string) => {
    const client = createClientMock(resourceName, getQueueContract(resourceName)) as ClientMock<T['schema'], ClientMode<T>>;

    tracker.method(client, 'sendMessage');
    tracker.method(client, 'receiveMessage');

    return client;
  };

  export const setClientMock = <T extends Queue.Service<any, Queue.Mode>>(resourceName: string) => {
    const client = getClientMock<T>(resourceName);

    Tester.mockServiceClient(resourceName, client);

    return client;
  };

  export const restoreClient = (resourceName: string) => {
    Tester.restoreServiceClient(resourceName);
  };

  /**
   * Messages the queue moved to its dead-letter queue, as the consumer receives them.
   */
  export const getDeadLetterMessages = <T extends Queue.Service<any, Queue.Mode>>(resourceName: string) => {
    return getLocalQueue(resourceName).getDeadLetterMessages() as T['schema'][];
  };

  /**
   * Resolves once the queue has no message waiting, delayed or in flight, and its consumers are done.
   * A message that keeps failing without a dead-letter queue keeps it waiting until the message expires.
   */
  export const waitForDrain = (resourceName: string) => {
    return getLocalQueue(resourceName).waitForDrain();
  };

  /**
   * Send a message to the queue through its emulator, which checks it the way the real client does before sending
   * (400 when it refuses it). The consumers take it out of the test's async context, so client overrides don't
   * reach them; `waitForDrain` resolves once they're done.
   */
  export const send = <T extends Queue.Service<any, Queue.Mode>>(
    resourceName: string,
    message: T['schema'],
    options?: SendOptions<ClientMode<T>>
  ) => {
    const { delay }: StandardSendOptions = { ...options };

    return Tester.request(resourceName, {
      headers: getMessageDelayHeaders(delay),
      body: message
    });
  };

  /**
   * Make the request a subscription handler receives for the given message, to call the handler directly. The
   * message goes through the checks of the real client and then the queue schema, as it reaches the runtime, so a
   * message either would refuse fails with its error. `retry` records its calls.
   */
  export const incoming = async <T extends Queue.Service<any, Queue.Mode>>(
    resourceName: string,
    message: T['schema'],
    overrides?: IncomingOverrides
  ): Promise<Incoming<T['schema']>> => {
    const service = getQueueContract(resourceName);

    if (!service) {
      throw new Error(`Queue [${resourceName}] isn't a queue the tester knows.`);
    }

    const { body, attributes } = await getOutgoingMessage(message, service, { traceId: overrides?.traceId });

    const safeMessage = await getJsonMessage(JSON.parse(body), service.schema, (value, validation) => {
      return resolveValidation(value, Tester.getContext(resourceName), validation.type);
    });

    return {
      requestId: overrides?.requestId ?? getRandomUUID(),
      traceId: attributes.traceId,
      attempt: overrides?.attempt ?? 1,
      maxAttempts: overrides?.maxAttempts ?? service.deadLetter?.maxAttempts ?? Defaults.MaxAttempts,
      retry: tracker.fn(overrides?.retry ?? (() => Promise.resolve())),
      message: safeMessage
    };
  };

  /**
   * Get the context the subscription handlers of the queue receive, where a client in `overrides` takes the place
   * of the linked one with its name.
   */
  export const getContext = <T extends Queue.Service<any, Queue.Mode>>(resourceName: string, overrides?: Partial<Service.Context<T>>) => {
    return Tester.getContext<Service.Context<T>>(resourceName, overrides);
  };
}

const getLocalQueue = (resourceName: string) => {
  const handle = getLocalQueueHandle(Tester.getServiceClient(resourceName));

  if (!handle) {
    throw new Error(`Queue [${resourceName}] has no local emulator to inspect, it's mocked or imported.`);
  }

  return handle;
};

const getQueueContract = (resourceName: string) => {
  const service = Tester.getServiceMetadata(resourceName);

  if (service && (isQueueService(service) || isQueueImport(service))) {
    return service;
  }

  return undefined;
};
