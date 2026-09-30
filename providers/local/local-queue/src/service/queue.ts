import type { MessageAttributes, OutgoingMessage } from '../utils/message';

import { getRandomUUID } from '@ez4/utils';
import { Logger } from '@ez4/logger';

import { InvalidParameterValueError } from '../utils/errors';

export type LocalQueueParameters = {
  queueName: string;
  fifoMode: boolean;
  visibilityTimeout: number;
  retention: number;
  delay: number;
  polling: number;
  deadLetter?: {
    maxAttempts: number;
    retention: number;
  };
};

export type ReceivedMessage = {
  readonly messageId: string;
  readonly receiptHandle: string;
  readonly receiveCount: number;
  readonly attributes: MessageAttributes;
  readonly groupId?: string;
  readonly body: string;
};

export type DeadLetterMessage = {
  readonly messageId: string;
  readonly receiveCount: number;
  readonly body: string;
};

export type LocalQueue = {
  sendMessage: (message: OutgoingMessage) => void;
  receiveMessages: (maxMessages: number) => ReceivedMessage[];
  pollMessages: (maxMessages?: number, waitTime?: number) => Promise<ReceivedMessage[]>;
  deleteMessage: (receiptHandle: string) => void;
  changeVisibility: (receiptHandle: string, timeout: number) => boolean;
  getDeadLetterMessages: () => DeadLetterMessage[];
  isEmpty: () => boolean;
  waitUntil: (condition: () => boolean) => Promise<void>;
  subscribe: (listener: () => void) => () => void;
  notify: () => void;
  shutdown: () => void;
};

type StoredMessage = {
  messageId: string;
  body: string;
  attributes: MessageAttributes;
  groupId?: string;
  deduplicationId?: string;
  sentAt: number;
  visibleAt: number;
  receiveCount: number;
  receivedAt?: number;
  receiptHandle?: string;
};

type StoredDeadLetter = DeadLetterMessage & {
  expireTime: number;
};

// SQS keeps each deduplication id of a FIFO queue for five minutes, within its message group.
const DEDUPLICATION_INTERVAL = 300_000;

// A received message stays invisible for 12 hours at most, counted from the receive.
const MAX_VISIBILITY_TIMEOUT = 43200;

const MAX_RECEIVE_MESSAGES = 10;

const MAX_RECEIVE_WAIT = 20;

const MAX_TIMER_DELAY = 2 ** 31 - 1;

// Works like an SQS queue: a message waits for its delay, becomes invisible for the visibility timeout on
// each receive, expires at the end of the retention and, once received the maximum number of times, moves
// to the dead-letter queue.
export const createLocalQueue = (parameters: LocalQueueParameters): LocalQueue => {
  const { queueName, fifoMode, deadLetter } = parameters;

  const messages: StoredMessage[] = [];
  const deadLetters: StoredDeadLetter[] = [];

  const deduplications = new Map<string, number>();
  const listeners = new Set<() => void>();

  let wakeUpTimer: NodeJS.Timeout | undefined;
  let wakeUpTime = Infinity;

  let isNotifying = false;
  let isStopped = false;

  const getExpireTime = (message: StoredMessage) => {
    return message.sentAt + parameters.retention * 60000;
  };

  const isInFlight = (message: StoredMessage, now: number) => {
    return message.receiptHandle !== undefined && message.visibleAt > now;
  };

  // Listeners run once for all the changes of the same turn, after the change that notified them.
  const notify = () => {
    if (isNotifying) {
      return;
    }

    isNotifying = true;

    queueMicrotask(() => {
      isNotifying = false;

      [...listeners].forEach((listener) => listener());
    });
  };

  const subscribe = (listener: () => void) => {
    listeners.add(listener);

    return () => {
      listeners.delete(listener);
    };
  };

  // One timer for the next message to become visible or to expire, which wakes the consumers up. It's
  // unreferenced, so a message waiting in the queue doesn't keep `ez4 test` from ending.
  const scheduleWakeUp = () => {
    if (isStopped) {
      return;
    }

    const now = Date.now();

    const nextTime = messages.reduce((time, message) => {
      const visibleTime = message.visibleAt > now ? message.visibleAt : Infinity;

      return Math.min(time, visibleTime, getExpireTime(message));
    }, Infinity);

    if (nextTime === wakeUpTime) {
      return;
    }

    clearTimeout(wakeUpTimer);

    wakeUpTimer = undefined;
    wakeUpTime = nextTime;

    if (nextTime === Infinity) {
      return;
    }

    wakeUpTimer = setTimeout(
      () => {
        wakeUpTimer = undefined;
        wakeUpTime = Infinity;

        dropExpiredMessages(Date.now());
        scheduleWakeUp();
        notify();
      },
      Math.min(Math.max(0, nextTime - now), MAX_TIMER_DELAY)
    );

    wakeUpTimer.unref();
  };

  const dropExpiredMessages = (now: number) => {
    const expiredMessages = messages.filter((message) => getExpireTime(message) <= now);

    for (const message of expiredMessages) {
      messages.splice(messages.indexOf(message), 1);

      Logger.warn(`Queue [${queueName}] dropped message [${message.messageId}] at the end of its retention.`);
    }

    if (expiredMessages.length) {
      notify();
    }
  };

  const moveToDeadLetter = (message: StoredMessage, now: number, retention: number) => {
    messages.splice(messages.indexOf(message), 1);

    // SQS keeps the time a standard message was sent when it moves it to the dead-letter queue, and restarts
    // it for a FIFO message.
    const retentionStart = fifoMode ? now : message.sentAt;

    deadLetters.push({
      messageId: message.messageId,
      receiveCount: message.receiveCount,
      body: message.body,
      expireTime: retentionStart + retention * 60000
    });

    Logger.error(
      `Queue [${queueName}] moved message [${message.messageId}] to its dead-letter queue, it reached its maximum attempts (${message.receiveCount}).`
    );

    notify();
  };

  const sendMessage = (message: OutgoingMessage) => {
    const now = Date.now();

    if (fifoMode && message.deduplicationId !== undefined) {
      for (const [deduplicationKey, expireTime] of deduplications) {
        if (expireTime <= now) {
          deduplications.delete(deduplicationKey);
        }
      }

      const deduplicationKey = JSON.stringify([message.groupId, message.deduplicationId]);

      // SQS accepts a duplicate, but never delivers it.
      if (deduplications.has(deduplicationKey)) {
        Logger.debug(`Queue [${queueName}] accepted a duplicate message without delivering it.`);
        return;
      }

      deduplications.set(deduplicationKey, now + DEDUPLICATION_INTERVAL);
    }

    messages.push({
      messageId: getRandomUUID(),
      body: message.body,
      attributes: message.attributes,
      groupId: message.groupId,
      deduplicationId: message.deduplicationId,
      visibleAt: now + (message.delay ?? parameters.delay) * 1000,
      receiveCount: 0,
      sentAt: now
    });

    scheduleWakeUp();
    notify();
  };

  const receiveMessages = (maxMessages: number) => {
    const now = Date.now();

    dropExpiredMessages(now);

    // A FIFO group with a message in flight delivers nothing until that message is deleted or visible again.
    const blockedGroups = new Set<string>();

    if (fifoMode) {
      for (const message of messages) {
        if (message.groupId !== undefined && isInFlight(message, now)) {
          blockedGroups.add(message.groupId);
        }
      }
    }

    const receivedMessages: ReceivedMessage[] = [];

    for (const message of [...messages]) {
      if (receivedMessages.length >= maxMessages) {
        break;
      }

      const orderedGroup = fifoMode ? message.groupId : undefined;

      if (orderedGroup !== undefined && blockedGroups.has(orderedGroup)) {
        continue;
      }

      if (message.visibleAt > now) {
        // No later message of the group goes before this one.
        if (orderedGroup !== undefined) {
          blockedGroups.add(orderedGroup);
        }

        continue;
      }

      if (deadLetter && message.receiveCount >= deadLetter.maxAttempts) {
        moveToDeadLetter(message, now, deadLetter.retention);
        continue;
      }

      const receiptHandle = getRandomUUID();

      message.receiveCount++;
      message.receiptHandle = receiptHandle;
      message.receivedAt = now;
      message.visibleAt = now + parameters.visibilityTimeout * 1000;

      receivedMessages.push({
        messageId: message.messageId,
        receiveCount: message.receiveCount,
        attributes: message.attributes,
        groupId: message.groupId,
        body: message.body,
        receiptHandle
      });
    }

    scheduleWakeUp();

    return receivedMessages;
  };

  const waitForChange = (timeout: number) => {
    return new Promise<void>((resolve) => {
      const onChange = () => {
        clearTimeout(timer);
        listeners.delete(onChange);
        resolve();
      };

      const timer = setTimeout(onChange, timeout);

      timer.unref();

      listeners.add(onChange);
    });
  };

  const pollMessages = async (maxMessages = 1, waitTime = parameters.polling) => {
    if (!Number.isInteger(maxMessages) || maxMessages < 1 || maxMessages > MAX_RECEIVE_MESSAGES) {
      throw new InvalidParameterValueError(
        `Must be between 1 and ${MAX_RECEIVE_MESSAGES}, if provided.`,
        'MaxNumberOfMessages',
        maxMessages
      );
    }

    if (!Number.isFinite(waitTime) || waitTime < 0 || waitTime > MAX_RECEIVE_WAIT) {
      throw new InvalidParameterValueError(`Must be >= 0 and <= ${MAX_RECEIVE_WAIT}, if provided.`, 'WaitTimeSeconds', waitTime);
    }

    const endTime = Date.now() + waitTime * 1000;

    let receivedMessages = receiveMessages(maxMessages);

    while (!receivedMessages.length && !isStopped && Date.now() < endTime) {
      await waitForChange(endTime - Date.now());

      receivedMessages = receiveMessages(maxMessages);
    }

    return receivedMessages;
  };

  const deleteMessage = (receiptHandle: string) => {
    const index = messages.findIndex((message) => message.receiptHandle === receiptHandle);

    // The receipt of an earlier receive doesn't delete a message received again since.
    if (index < 0) {
      return;
    }

    messages.splice(index, 1);

    scheduleWakeUp();
    notify();
  };

  const changeVisibility = (receiptHandle: string, timeout: number) => {
    const now = Date.now();

    const message = messages.find((message) => message.receiptHandle === receiptHandle);

    // Only a message in flight changes, any other is already visible again or gone.
    if (!message || !isInFlight(message, now)) {
      return false;
    }

    const receivedAt = message.receivedAt ?? now;

    if (!Number.isFinite(timeout) || timeout < 0 || now + timeout * 1000 > receivedAt + MAX_VISIBILITY_TIMEOUT * 1000) {
      throw new InvalidParameterValueError(
        `Total VisibilityTimeout for the message is beyond the limit [${MAX_VISIBILITY_TIMEOUT} seconds]`,
        'VisibilityTimeout',
        timeout
      );
    }

    message.visibleAt = now + timeout * 1000;

    scheduleWakeUp();
    notify();

    return true;
  };

  const getDeadLetterMessages = () => {
    const now = Date.now();

    const expiredLetters = deadLetters.filter(({ expireTime }) => expireTime <= now);

    for (const deadLetter of expiredLetters) {
      deadLetters.splice(deadLetters.indexOf(deadLetter), 1);
    }

    return deadLetters.map(({ messageId, receiveCount, body }) => ({ messageId, receiveCount, body }));
  };

  const isEmpty = () => {
    dropExpiredMessages(Date.now());

    return !messages.length;
  };

  const waitUntil = (condition: () => boolean) => {
    return new Promise<void>((resolve) => {
      const onChange = () => {
        if (isStopped || condition()) {
          listeners.delete(onChange);
          resolve();
        }
      };

      listeners.add(onChange);

      onChange();
    });
  };

  // Whoever still waits on the queue gets an answer, and the queue schedules nothing else.
  const shutdown = () => {
    isStopped = true;

    clearTimeout(wakeUpTimer);

    wakeUpTimer = undefined;

    [...listeners].forEach((listener) => listener());

    listeners.clear();
  };

  return {
    sendMessage,
    receiveMessages,
    pollMessages,
    deleteMessage,
    changeVisibility,
    getDeadLetterMessages,
    isEmpty,
    waitUntil,
    subscribe,
    notify,
    shutdown
  };
};
