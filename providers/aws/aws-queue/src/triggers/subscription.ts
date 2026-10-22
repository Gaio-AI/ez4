import type { DeployOptions, EventContext } from '@ez4/project/library';
import type { QueueService, QueueImport } from '@ez4/queue/library';
import type { EntryStates } from '@ez4/state';
import type { QueueState } from '../queue/types';

import { isLinkedContextVpcRequired, linkServiceContext } from '@ez4/project/library';
import { AttributeKeyType, AttributeType, createTable } from '@ez4/aws-dynamodb';
import { getFunctionState, tryGetFunctionState } from '@ez4/aws-function';
import { isRoleState } from '@ez4/aws-identity';
import { createLogGroup } from '@ez4/aws-logs';

import { createMapping } from '../mapping/service';
import { createQueueFunction } from '../mapping/function/service';
import { ClaimsExpirationAttribute, ClaimsKeyAttribute } from '../mapping/function/claims';
import { getClaimsTableName, getFunctionName, getInternalName, getMaxWaitForBatchSize } from './utils';
import { RoleMissingError } from './errors';
import { Defaults } from './defaults';

export const prepareSubscriptions = (
  state: EntryStates,
  service: QueueService | QueueImport,
  queueState: QueueState,
  options: DeployOptions,
  context: EventContext
) => {
  if (!context.role || !isRoleState(context.role)) {
    throw new RoleMissingError();
  }

  const { deadLetter, backoff, subscriptions } = service;

  const claimsTableState = prepareClaimsTable(state, service, options);

  for (const subscription of subscriptions) {
    const { handler, listener, idempotency } = subscription;

    const internalName = getInternalName(service, handler.name);

    let handlerState = tryGetFunctionState(context, internalName, options);

    if (!handlerState) {
      const { defaults, release, tags } = options;

      const subscriptionName = getFunctionName(service, handler.name, options);
      const dependencies = context.getDependencyFiles(handler.file);

      const {
        runtime = defaults?.runtime ?? Defaults.Runtime,
        architecture = defaults?.architecture ?? Defaults.Architecture,
        logRetention = defaults?.logRetention ?? Defaults.LogRetention,
        logLevel = defaults?.logLevel ?? Defaults.LogLevel,
        memory = defaults?.memory ?? Defaults.Memory,
        debug = options.debug,
        files,
        vpc
      } = subscription;

      const logGroupState = createLogGroup(state, {
        dependencies: [queueState.entryId],
        groupName: subscriptionName,
        retention: logRetention,
        tags
      });

      const timeout = service.timeout ?? Defaults.Timeout;

      handlerState = createQueueFunction(state, context.role, logGroupState, {
        functionName: subscriptionName,
        messageSchema: service.schema,
        description: handler.summary ?? handler.description,
        variables: [options.variables, service.variables, subscription.variables],
        references: subscription.handler.references,
        context: service.context,
        dependencies: claimsTableState ? [queueState.entryId, claimsTableState.entryId] : [queueState.entryId],
        timeout,
        backoff: {
          attempts: deadLetter?.maxAttempts ?? Defaults.MaxAttempts,
          minDelay: backoff?.minDelay ?? Defaults.MinBackoff,
          maxDelay: backoff?.maxDelay ?? Defaults.MaxBackoff,
          window: backoff ? 0 : Defaults.RetryWindow
        },
        parallelism: subscription.parallelism ?? Defaults.Parallelism,
        acknowledge: subscription.acknowledge ?? Defaults.Acknowledge,
        ...(idempotency &&
          claimsTableState && {
            idempotency: {
              tableName: claimsTableState.parameters.tableName,
              key: idempotency.key,
              ttl: idempotency.ttl,
              lease: timeout
            }
          }),
        handler: {
          sourceFile: handler.file,
          functionName: handler.name,
          module: handler.module,
          dependencies
        },
        listener: listener && {
          functionName: listener.name,
          sourceFile: listener.file,
          module: listener.module
        },
        systemLogLevel: defaults?.systemLogLevel,
        architecture,
        logLevel,
        runtime,
        release,
        memory,
        files,
        debug,
        tags,
        vpc
      });

      context.setServiceState(internalName, options, handlerState);
    }

    const { batch = Defaults.Batch, concurrency } = subscription;
    const { fifoMode } = service;

    createMapping(state, queueState, handlerState, {
      fromService: internalName,
      concurrency,
      batch: {
        ...(!fifoMode && { maxWait: getMaxWaitForBatchSize(batch) }),
        size: batch
      }
    });
  }
};

// One table keeps the keys of every subscription of the queue that runs its messages once. It only holds keys that
// expire, so it goes away with the last subscription that uses it.
const prepareClaimsTable = (state: EntryStates, service: QueueService | QueueImport, options: DeployOptions) => {
  if (!service.subscriptions.some(({ idempotency }) => !!idempotency)) {
    return undefined;
  }

  return createTable(state, {
    tableName: getClaimsTableName(service, options),
    attributeSchema: [
      [
        {
          attributeName: ClaimsKeyAttribute,
          attributeType: AttributeType.String,
          keyType: AttributeKeyType.Hash
        }
      ]
    ],
    ttlAttribute: ClaimsExpirationAttribute,
    allowDeletion: true,
    tags: options.tags
  });
};

export const connectSubscriptions = (
  state: EntryStates,
  service: QueueService | QueueImport,
  options: DeployOptions,
  context: EventContext
) => {
  if (!context.role || !isRoleState(context.role)) {
    throw new RoleMissingError();
  }

  for (const { handler } of service.subscriptions) {
    const internalName = getInternalName(service, handler.name);
    const handlerState = getFunctionState(context, internalName, options);

    linkServiceContext(state, handlerState.entryId, service.context);

    if (!handlerState.parameters.vpc) {
      handlerState.parameters.vpc = isLinkedContextVpcRequired(service.context);
    }
  }
};
