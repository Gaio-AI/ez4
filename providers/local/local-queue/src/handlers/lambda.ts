import type { QueueService, QueueSubscription } from '@ez4/queue/library';
import type { EmulateServiceContext, ServeOptions } from '@ez4/project/library';
import type { ValidationCustomContext } from '@ez4/validator';
import type { VirtualModule } from '@ez4/local-common';
import type { Queue } from '@ez4/queue';
import type { LocalQueue, ReceivedMessage } from '../service/queue';

import { createModule, onBegin, onReady, onDone, onError, onEnd, onTimeout } from '@ez4/local-common';
import { getJsonMessage, resolveValidation } from '@ez4/queue/utils';
import { getRandomUUID, pickObject, Tasks, Wait } from '@ez4/utils';
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
  const { handler, listener } = subscription;

  const timeout = (service.timeout ?? Defaults.Timeout) * 1000;
  const deadline = Date.now() + timeout;

  const maxAttempts = service.deadLetter?.maxAttempts ?? Defaults.MaxAttempts;
  const minBackoff = service.backoff?.minDelay ?? Defaults.MinBackoff;
  const maxBackoff = service.backoff?.maxDelay ?? Defaults.MaxBackoff;
  const parallelism = subscription.parallelism ?? Defaults.Parallelism;

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

  const processRecord = (module: VirtualModule, message: ReceivedMessage, deleteEachRecord: boolean) => {
    const { traceId, scope } = message.attributes;

    // Records run side by side, so each one keeps its own scope for what it logs and sends.
    return Runtime.runWithScope(async () => {
      Runtime.importScope(traceId, scope);

      const outcome: RecordOutcome = {
        handedBack: false,
        holdsGroup: false
      };

      let currentRequest: Queue.Incoming<Queue.Message> | undefined;
      let handled = false;

      try {
        const payload = JSON.parse(message.body);
        const safeMessage = await getJsonMessage(payload, schema, onCustomValidation);

        const retry = (retryOptions?: Queue.RetryOptions) => {
          outcome.handedBack = true;
          outcome.holdsGroup = true;

          retryMessage(message, retryOptions?.delay);

          return Promise.resolve();
        };

        currentRequest = {
          ...request,
          attempt: message.receiveCount,
          message: safeMessage,
          traceId,
          retry
        };

        activeRequests.set(currentRequest, message);

        await onReady(module, serviceClients, currentRequest);
        await module.handler(currentRequest, serviceClients);

        handled = true;

        if (deleteEachRecord && !outcome.handedBack) {
          ackMessage(message);
        }

        await onDone(module, serviceClients, currentRequest);
      } catch (error) {
        await onError(module, serviceClients, currentRequest ?? request, error);

        outcome.holdsGroup = true;

        // A record whose handler finished is consumed even when a hook after it fails: sending it back
        // would run it again.
        if (!handled) {
          outcome.handedBack = true;

          logFailure(message, retryMessage(message));
        }
      } finally {
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
    // no delete of its own. In a longer batch each record is deleted as soon as it's handled.
    const deleteEachRecord = messages.length > 1;

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
