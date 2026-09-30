import type { Client, Queue, SendOptions } from '@ez4/queue';
import type { CommonOptions } from '@ez4/project/library';
import type { QueueImport } from '@ez4/queue/library';
import type { OutgoingMessage } from '../utils/message';

import { getServiceName } from '@ez4/project/library';
import { captureMessageTrace, getMessageTraceHeaders } from '@ez4/local-common';
import { Logger } from '@ez4/logger';

import { getMessageDelayHeaders, getOutgoingMessage } from '../utils/message';

export type RemoteClientOptions = CommonOptions & {
  serviceHost: string;
};

export type QueueForwarder = {
  queueHost: string;
  forwardMessage: (message: OutgoingMessage) => void;
  stop: () => void;
};

type PendingMessage = {
  message: OutgoingMessage;
  waitStart: number;
};

type ForwardResult = 'sent' | 'refused' | 'unavailable';

// Specs run in the same process and may stub globalThis.fetch, so the emulator traffic keeps the native one.
const nativeFetch = globalThis.fetch;

// The project that owns the queue starts along with this one or restarts on its own, so a message it doesn't
// take is sent again after each of these delays, and dropped once it has waited for all of them.
const RETRY_DELAYS = [1000, 2000, 4000, 8000, 16000];

const MAX_WAIT_TIME = RETRY_DELAYS.reduce((total, delay) => total + delay, 0);

export const createRemoteClient = <T extends Queue.Message = any, U extends Queue.Mode = any>(
  service: QueueImport,
  forwarder: QueueForwarder
): Client<T, U> => {
  const { reference: resourceName } = service;

  return new (class {
    async sendMessage(message: T, options?: SendOptions<U>) {
      // The trace is taken before anything else, callers import the scope right before sending.
      const trace = captureMessageTrace();

      Logger.log(`✉️  Sending message to queue [${resourceName}] at ${forwarder.queueHost}.`);

      // The checks of the real client and of SQS fail here, where production fails the send.
      const outgoingMessage = await getOutgoingMessage(message, service, trace, options?.delay);

      forwarder.forwardMessage(outgoingMessage);
    }

    receiveMessage(): Promise<T[]> {
      throw new Error(`Receive message isn't supported yet.`);
    }
  })();
};

// Messages go to the owner one at a time, so they reach its queue in the order they were sent.
export const createQueueForwarder = (resourceName: string, clientOptions: RemoteClientOptions): QueueForwarder => {
  const queueIdentifier = getServiceName(resourceName, clientOptions);
  const queueHost = `http://${clientOptions.serviceHost}/${queueIdentifier}`;

  const pendingMessages: PendingMessage[] = [];

  let retryTimer: NodeJS.Timeout | undefined;

  let isRequesting = false;
  let isSending = false;
  let isStopped = false;

  // Time spent waiting for the owner, which a pending message counts its wait from.
  let waitTime = 0;
  let failures = 0;

  const sendMessage = async ({ body, attributes, delay }: OutgoingMessage): Promise<ForwardResult> => {
    try {
      const response = await nativeFetch(queueHost, {
        method: 'POST',
        body,
        headers: {
          ['content-type']: 'application/json',
          ...getMessageTraceHeaders(attributes),
          ...getMessageDelayHeaders(delay)
        }
      });

      const responseBody = await response.text();

      if (response.ok) {
        return 'sent';
      }

      // A reload of the owner with errors leaves the queue out of its services, and a failing owner answers 5xx.
      if (response.status === 404 || response.status >= 500) {
        return 'unavailable';
      }

      Logger.error(`Remote queue [${resourceName}] at ${queueHost} refused a message: ${getErrorMessage(responseBody)}`);

      return 'refused';
      //
    } catch {
      return 'unavailable';
    }
  };

  const dropExpiredMessages = () => {
    while (pendingMessages.length && waitTime - pendingMessages[0].waitStart >= MAX_WAIT_TIME) {
      pendingMessages.shift();

      Logger.error(`Remote queue [${resourceName}] at ${queueHost} isn't available, a message was dropped after ${MAX_WAIT_TIME / 1000}s.`);
    }
  };

  const sendPendingMessages = async () => {
    if (isSending || isStopped) {
      return;
    }

    isSending = true;

    while (pendingMessages.length && !isStopped) {
      isRequesting = true;

      const result = await sendMessage(pendingMessages[0].message);

      isRequesting = false;

      if (result !== 'unavailable') {
        pendingMessages.shift();
        failures = 0;
        continue;
      }

      failures++;

      dropExpiredMessages();

      // With every message dropped, the next one starts over from the first retry delay.
      if (!pendingMessages.length || isStopped) {
        failures = 0;
        break;
      }

      const retryDelay = RETRY_DELAYS[Math.min(failures, RETRY_DELAYS.length) - 1];

      if (failures === 1) {
        Logger.warn(`Remote queue [${resourceName}] at ${queueHost} isn't available, sending again in ${retryDelay / 1000}s.`);
      }

      // Unreferenced, so a message waiting for the owner doesn't keep `ez4 test` from ending.
      retryTimer = setTimeout(() => {
        retryTimer = undefined;
        waitTime += retryDelay;
        isSending = false;

        sendPendingMessages();
      }, retryDelay);

      retryTimer.unref();

      return;
    }

    isSending = false;
  };

  return {
    queueHost,
    forwardMessage: (message) => {
      pendingMessages.push({
        waitStart: waitTime,
        message
      });

      sendPendingMessages();
    },
    stop: () => {
      isStopped = true;

      clearTimeout(retryTimer);

      // The message of a request on its way may still reach the owner.
      const droppedMessages = pendingMessages.length - (isRequesting ? 1 : 0);

      if (droppedMessages > 0) {
        Logger.warn(`Remote queue [${resourceName}] at ${queueHost} dropped ${droppedMessages} message(s) waiting for the owner.`);
      }

      pendingMessages.length = 0;
    }
  };
};

const getErrorMessage = (responseBody: string) => {
  try {
    return JSON.parse(responseBody).message ?? responseBody;
  } catch {
    return responseBody;
  }
};
