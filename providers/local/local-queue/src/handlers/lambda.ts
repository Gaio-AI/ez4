import type { QueueService, QueueSubscription } from '@ez4/queue/library';
import type { EmulateServiceContext, ServeOptions } from '@ez4/project/library';
import type { ValidationCustomContext } from '@ez4/validator';
import type { VirtualModule } from '@ez4/local-common';
import type { Queue } from '@ez4/queue';
import type { LocalQueue, ReceivedMessage } from '../service/queue';
import type { HeldClaim } from '../service/claims';

import { createModule, onBegin, onReady, onDone, onError, onEnd, onTimeout } from '@ez4/local-common';
import {
  MaxDeferCount,
  MaxDeferDelay,
  getConcurrencySlotKey,
  getIdempotencyKey,
  getJsonMessage,
  getSlotWaitDelay,
  isUnknownOutcomeError,
  resolveValidation
} from '@ez4/queue/utils';

import { getRandomInteger, getRandomUUID, pickObject, Tasks, Wait } from '@ez4/utils';
import { Runtime } from '@ez4/common';
import { Logger } from '@ez4/logger';

import { Defaults } from '../utils/defaults';

// Time kept at the end of the invocation to report a timeout before the runtime is stopped.
const TIMEOUT_MARGIN = 1000;

type RecordOutcome = {
  handedBack: boolean;
  holdsGroup: boolean;
};

// Runs a batch like the queue runtime of @ez4/aws-queue runs a Lambda invocation. A handler can't be stopped
// in-process, so at the timeout the batch lets go of its place and of the messages it didn't finish, which
// the queue delivers again once they're visible, while the handler runs on and its outcome is ignored.
export const processLambdaBatch = (
  service: QueueService,
  options: ServeOptions,
  context: EmulateServiceContext,
  subscription: QueueSubscription,
  queue: LocalQueue,
  messages: ReceivedMessage[],
  signal: AbortSignal
) => {
  const { name: queueName, services, schema } = service;
  const { handler, listener, idempotency, keyConcurrency } = subscription;

  const timeout = (service.timeout ?? Defaults.Timeout) * 1000;
  const deadline = Date.now() + timeout;

  const maxAttempts = service.deadLetter?.maxAttempts ?? Defaults.MaxAttempts;
  const minBackoff = service.backoff?.minDelay ?? Defaults.MinBackoff;
  const maxBackoff = service.backoff?.maxDelay ?? Defaults.MaxBackoff;
  const parallelism = subscription.parallelism ?? Defaults.Parallelism;
  const acknowledge = subscription.acknowledge ?? Defaults.Acknowledge;

  const servicesInUse = handler.references ? pickObject(services, handler.references) : services;
  const serviceClients = context.makeClients(servicesInUse);

  const request = {
    requestId: getRandomUUID(),
    attempt: Number.NaN,
    maxAttempts
  };

  const activeRequests = new Map<Queue.Incoming<Queue.Message>, ReceivedMessage>();

  let batchModule: VirtualModule | undefined;
  let isAbandoned = false;

  const onCustomValidation = (value: unknown, validation: ValidationCustomContext) => {
    return resolveValidation(value, serviceClients, validation.type);
  };

  const ackMessage = (message: ReceivedMessage) => {
    if (!isAbandoned) {
      queue.deleteMessage(message.receiptHandle);
    }
  };

  const retryMessage = (message: ReceivedMessage, userDelay?: number) => {
    if (isAbandoned) {
      return undefined;
    }

    const delay = userDelay ?? Wait.delay(message.receiveCount, maxAttempts, minBackoff, maxBackoff);

    try {
      return queue.changeVisibility(message.receiptHandle, delay) ? delay : undefined;
    } catch (error) {
      // Like the runtime, a refused change leaves the message for its visibility timeout.
      Logger.warn(`Queue [${queueName}] message [${message.messageId}] keeps its visibility: ${error}`);
      return undefined;
    }
  };

  const logFailure = (message: ReceivedMessage, delay: number | undefined) => {
    const failure = `Queue [${queueName}] message [${message.messageId}] failed on attempt ${message.receiveCount}`;

    if (delay === undefined) {
      return Logger.warn(`${failure}.`);
    }

    Logger.warn(`${failure}, it's visible again in ${delay}s.`);
  };

  const failRecord = (
    message: ReceivedMessage,
    heldClaim: HeldClaim | undefined,
    error: unknown,
    deleteEachRecord: boolean,
    outcome: RecordOutcome
  ) => {
    // The work may or may not have happened: the key is kept as if it ran, and the message is consumed so it runs
    // neither again nor twice.
    if (heldClaim && idempotency && isUnknownOutcomeError(error)) {
      queue.claims.keep(heldClaim, 'unknown', idempotency.ttl * 1000);

      if (deleteEachRecord) {
        ackMessage(message);
      }

      return;
    }

    if (heldClaim) {
      queue.claims.release(heldClaim);
    }

    outcome.handedBack = true;

    logFailure(message, retryMessage(message));
  };

  // A copy the queue delivers after the delay (in seconds), as a new message with no attempt spent. A delay past the
  // longest wait a queue takes is made of waits that long, the copy carrying when it's due. A `counted` wait counts
  // toward the most a message is deferred, past which it fails like with an error.
  const sendDeferredCopy = (message: ReceivedMessage, delay: number, counted: boolean) => {
    const previousCount = message.attributes.defers ?? 0;
    const defers = counted ? previousCount + 1 : previousCount;

    if (defers > MaxDeferCount) {
      throw new Error(`The message was already deferred ${MaxDeferCount} times, the most it takes.`);
    }

    if (isAbandoned) {
      return;
    }

    const wait = Math.max(0, Math.ceil(delay));
    const queueWait = Math.min(wait, MaxDeferDelay);

    const reason = counted ? `deferred ${defers} of ${MaxDeferCount} times` : 'every slot of its key is held';

    Logger.log(`Queue [${queueName}] message [${message.messageId}] comes back in ${wait}s, ${reason}.`);

    queue.sendMessage({
      body: message.body,
      attributes: {
        traceId: message.attributes.traceId,
        scope: message.attributes.scope,
        defers,
        ...(wait > queueWait && {
          deferUntil: Date.now() + wait * 1000
        })
      },
      delay: queueWait
    });
  };

  // The slots are tried from a random one, so the executions of a busy key don't all take the same slot first.
  const takeSlot = (safeMessage: Queue.Message) => {
    if (!keyConcurrency) {
      return undefined;
    }

    const firstSlot = getRandomInteger(0, keyConcurrency.max - 1);

    for (let offset = 0; offset < keyConcurrency.max; offset++) {
      const slot = (firstSlot + offset) % keyConcurrency.max;
      const slotResult = queue.claims.take(getConcurrencySlotKey(handler.name, safeMessage, keyConcurrency.key, slot), timeout);

      if (slotResult.status === 'taken') {
        return slotResult.claim;
      }
    }

    return undefined;
  };

  const processRecord = (module: VirtualModule, message: ReceivedMessage, deleteEachRecord: boolean) => {
    const { traceId, scope } = message.attributes;

    // Records run side by side, so each one keeps its own scope for what it logs and sends.
    return Runtime.runWithScope(async () => {
      Runtime.importScope(traceId, scope);

      const outcome: RecordOutcome = {
        handedBack: false,
        holdsGroup: false
      };

      let currentRequest: Queue.DeferrableIncoming<Queue.Message> | undefined;
      let heldClaim: HeldClaim | undefined;
      let heldSlot: HeldClaim | undefined;
      let deferred = false;
      let handled = false;

      // The message leaves the queue without its handler running (again): it already ran, or a copy took its place.
      const consumeMessage = () => {
        if (deleteEachRecord) {
          ackMessage(message);
        }
      };

      try {
        // A copy deferred past the longest wait a queue takes comes back early, and waits again.
        const waitLeft = (message.attributes.deferUntil ?? 0) - Date.now();

        if (waitLeft > 0) {
          sendDeferredCopy(message, waitLeft / 1000, true);
          consumeMessage();

          return outcome;
        }

        const payload = JSON.parse(message.body);
        const safeMessage = await getJsonMessage(payload, schema, onCustomValidation);

        if (idempotency) {
          const claimKey = getIdempotencyKey(handler.name, safeMessage, idempotency.key);
          const claimResult = queue.claims.take(claimKey, timeout);

          if (claimResult.status === 'done') {
            Logger.log(`Queue [${queueName}] message [${message.messageId}] already ran for its key, it's acknowledged without running.`);

            consumeMessage();

            return outcome;
          }

          if (claimResult.status === 'busy') {
            Logger.warn(`Queue [${queueName}] message [${message.messageId}] goes back, its key is running in another execution.`);

            outcome.handedBack = true;
            outcome.holdsGroup = true;

            retryMessage(message);

            return outcome;
          }

          heldClaim = claimResult.claim;
        }

        if (keyConcurrency) {
          heldSlot = takeSlot(safeMessage);

          // Every slot of its key is held: the message waits its turn without spending an attempt.
          if (!heldSlot) {
            sendDeferredCopy(message, getSlotWaitDelay(), false);

            if (heldClaim) {
              queue.claims.release(heldClaim);
            }

            consumeMessage();

            return outcome;
          }
        }

        const retry = (retryOptions?: Queue.RetryOptions) => {
          if (deferred) {
            return Promise.reject(new Error('The message was already deferred.'));
          }

          outcome.handedBack = true;
          outcome.holdsGroup = true;

          retryMessage(message, retryOptions?.delay);

          return Promise.resolve();
        };

        const defer = (deferOptions: Queue.DeferOptions) => {
          if (message.groupId !== undefined) {
            return Promise.reject(new Error(`A message of a FIFO queue can't be deferred.`));
          }

          if (outcome.handedBack || deferred) {
            return Promise.reject(new Error('The message was already handed back.'));
          }

          try {
            sendDeferredCopy(message, deferOptions.delay, true);
          } catch (error) {
            return Promise.reject(error);
          }

          deferred = true;

          return Promise.resolve();
        };

        currentRequest = {
          ...request,
          attempt: message.receiveCount,
          message: safeMessage,
          traceId,
          retry,
          defer
        };

        activeRequests.set(currentRequest, message);

        await onReady(module, serviceClients, currentRequest);
        await module.handler(currentRequest, serviceClients);

        handled = true;

        // A handler that handed its message back, or put it off, runs it again later, so the key goes back with it.
        if (heldClaim && idempotency) {
          if (outcome.handedBack || deferred) {
            queue.claims.release(heldClaim);
          } else {
            queue.claims.keep(heldClaim, 'done', idempotency.ttl * 1000);
          }
        }

        if (deleteEachRecord && !outcome.handedBack) {
          ackMessage(message);
        }

        await onDone(module, serviceClients, currentRequest);
      } catch (error) {
        await onError(module, serviceClients, currentRequest ?? request, error);

        outcome.holdsGroup = true;

        // A record whose handler finished is consumed even when a hook after it fails: sending it back
        // would run it again. One whose handler put it off already has its copy in the queue.
        if (deferred && !handled) {
          if (heldClaim) {
            queue.claims.release(heldClaim);
          }

          consumeMessage();
        } else if (!handled) {
          failRecord(message, heldClaim, error, deleteEachRecord, outcome);
        }
      } finally {
        if (heldSlot) {
          queue.claims.release(heldSlot);
        }

        if (currentRequest) {
          activeRequests.delete(currentRequest);
        }
      }

      return outcome;
    });
  };

  const processAllRecords = async (module: VirtualModule) => {
    const failedMessageIds = new Set<string>();
    const failedGroupIds = new Set<string>();

    // The event source mapping deletes every record left out of the batch response, so a lone record needs
    // no delete of its own. In a longer batch each record is deleted as soon as it's handled, unless a batch
    // acknowledge leaves every delete to the end of the invocation.
    const deleteEachRecord = acknowledge !== 'batch' && messages.length > 1;

    const groupTurns = new Map<string, Promise<void>>();

    // After the first records finish, a record starts only while the invocation has time left for the
    // slowest one so far.
    let slowestRecord = 0;

    // A failure the batch response can't carry fails the invocation: no other record starts.
    let batchFailure: { reason: unknown } | undefined;

    const recordTasks = messages.map((message) => {
      const { messageId, groupId } = message;

      const previousInGroup = groupId !== undefined ? groupTurns.get(groupId) : undefined;

      let endTurn = () => {};

      const turn = new Promise<void>((resolve) => {
        endTurn = resolve;
      });

      if (groupId !== undefined) {
        groupTurns.set(groupId, turn);
      }

      return async () => {
        try {
          // Messages from the same group run in order, and once one of them fails the next ones are
          // skipped to avoid duplication.
          await previousInGroup;

          if (batchFailure || isAbandoned) {
            return;
          }

          if (groupId !== undefined && failedGroupIds.has(groupId)) {
            failedMessageIds.add(messageId);
            return;
          }

          const timeLeft = deadline - Date.now() - TIMEOUT_MARGIN;

          if (slowestRecord > 0 && timeLeft <= slowestRecord) {
            Logger.warn(
              `Queue [${queueName}] message [${messageId}] goes back, ${timeLeft}ms left and the slowest one took ${slowestRecord}ms.`
            );

            failedMessageIds.add(messageId);

            if (groupId !== undefined) {
              failedGroupIds.add(groupId);
            }

            return;
          }

          const startTime = Date.now();

          const { handedBack, holdsGroup } = await processRecord(module, message, deleteEachRecord);

          slowestRecord = Math.max(slowestRecord, Date.now() - startTime);

          if (handedBack) {
            failedMessageIds.add(messageId);
          }

          if (holdsGroup && groupId !== undefined) {
            failedGroupIds.add(groupId);
          }
        } catch (reason) {
          batchFailure ??= { reason };
        } finally {
          endTurn();
        }
      };
    });

    // Records are taken in batch order, so a parallelism of one runs the batch one after another.
    await Tasks.run(recordTasks, {
      concurrency: Math.max(1, Math.trunc(parallelism) || 1)
    });

    if (batchFailure) {
      throw batchFailure.reason;
    }

    return failedMessageIds;
  };

  const reportTimeout = async (module: VirtualModule) => {
    const reportRequest = (pendingRequest: Partial<Queue.Request | Queue.Incoming<Queue.Message>>) => {
      Logger.warn(`Queue [${queueName}] handler [${handler.name}] is about to reach its timeout of ${timeout / 1000}s.`);

      return onTimeout(module, serviceClients, pendingRequest);
    };

    if (!activeRequests.size) {
      await reportRequest(request);
      return;
    }

    // The timer runs outside the records, so each report takes the scope of the record it's about.
    await Promise.all(
      [...activeRequests].map(([activeRequest, { attributes }]) => {
        return Runtime.runWithScope(() => {
          Runtime.importScope(attributes.traceId, attributes.scope);

          return reportRequest(activeRequest);
        });
      })
    );
  };

  const runBatch = async () => {
    const module = await createModule({
      listener,
      handler,
      version: options.version,
      variables: {
        ...options.variables,
        ...service.variables,
        ...subscription.variables
      }
    });

    batchModule = module;

    let failedMessageIds: Set<string> | undefined;

    try {
      await onBegin(module, serviceClients, request);

      failedMessageIds = await processAllRecords(module);
    } catch (error) {
      await onError(module, serviceClients, request, error);
    } finally {
      await onEnd(module, serviceClients, request);
    }

    // After the invocation, the event source mapping deletes every record the batch didn't hand back. A
    // failed invocation hands them all back, for their visibility timeout.
    if (failedMessageIds && !isAbandoned) {
      for (const message of messages) {
        if (!failedMessageIds.has(message.messageId)) {
          queue.deleteMessage(message.receiptHandle);
        }
      }
    }
  };

  // The batch runs in a scope of its own, apart from the scope of whoever sent the messages.
  return Runtime.runWithScope(() => {
    return new Promise<void>((release) => {
      const stopBatch = () => {
        isAbandoned = true;

        clearTimeout(timeoutTimer);
        clearTimeout(deadlineTimer);

        release();
      };

      const timeoutTimer = setTimeout(
        () => {
          if (batchModule) {
            reportTimeout(batchModule).catch((error) => Logger.error(`${error}`));
          }
        },
        Math.max(0, timeout - TIMEOUT_MARGIN)
      );

      const deadlineTimer = setTimeout(() => {
        Logger.warn(`Queue [${queueName}] handler [${handler.name}] reached its timeout, its unfinished messages go back to the queue.`);
        stopBatch();
      }, timeout);

      // Unreferenced, so a batch doesn't keep `ez4 test` from ending.
      timeoutTimer.unref();
      deadlineTimer.unref();

      signal.addEventListener('abort', stopBatch, { once: true });

      runBatch()
        .catch((error) => Logger.error(`${error}`))
        .finally(() => {
          clearTimeout(timeoutTimer);
          clearTimeout(deadlineTimer);

          signal.removeEventListener('abort', stopBatch);

          release();
        });
    });
  });
};
