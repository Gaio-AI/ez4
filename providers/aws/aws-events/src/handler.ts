import type { StepContext, StepHandler } from '@ez4/state';
import type { FunctionState } from '@ez4/aws-function';
import type { EventsRuleResult, EventsRuleState, EventsRuleParameters } from './types';
import { CorruptedResourceError, OperationLogger } from '@ez4/aws-common';
import { deepCompare } from '@ez4/utils';
import { putEventsRule as defaultPut, deleteEventsRule as defaultDelete } from './client';
import { EventsRuleServiceName } from './types';

export type EventsRuleHandlerOptions = {
  putRule?: (parameters: EventsRuleParameters, targetArn: string) => Promise<EventsRuleResult>;
  deleteRule?: (parameters: EventsRuleParameters, targetArn: string) => Promise<void>;
};

const getTargetArn = (candidate: EventsRuleState, context: StepContext): string => {
  const target = context.getDependencies<FunctionState>().find((entry) => entry.entryId === candidate.parameters.targetId);
  const arn = target?.result?.functionArn;
  if (!arn) {
    throw new CorruptedResourceError(EventsRuleServiceName, candidate.parameters.name);
  }
  return arn;
};

export const getEventsRuleHandler = (options?: EventsRuleHandlerOptions): StepHandler<EventsRuleState> => {
  const putFn = options?.putRule ?? defaultPut;
  const deleteFn = options?.deleteRule ?? defaultDelete;

  return {
    equals: (candidate, current) => candidate.result?.arn === current.result?.arn,
    preview: (candidate, current) => {
      const changes = deepCompare(candidate.parameters, current.parameters);
      return changes.counts ? { ...changes, name: candidate.parameters.name } : undefined;
    },
    create: (candidate, context) =>
      OperationLogger.logExecution(EventsRuleServiceName, candidate.parameters.name, 'creation', async () =>
        putFn(candidate.parameters, getTargetArn(candidate, context))
      ),
    replace: (candidate, _current, context) =>
      OperationLogger.logExecution(EventsRuleServiceName, candidate.parameters.name, 'creation', async () =>
        putFn(candidate.parameters, getTargetArn(candidate, context))
      ),
    update: (candidate, current, context) => {
      const arn = getTargetArn(candidate, context);
      if (
        candidate.result?.targetArn === arn &&
        candidate.parameters.name === current.parameters.name &&
        candidate.parameters.eventPattern === current.parameters.eventPattern &&
        candidate.parameters.scheduleExpression === current.parameters.scheduleExpression
      ) {
        return Promise.resolve();
      }
      return OperationLogger.logExecution(EventsRuleServiceName, candidate.parameters.name, 'updates', async () =>
        putFn(candidate.parameters, arn)
      );
    },
    delete: (current) =>
      OperationLogger.logExecution(EventsRuleServiceName, current.parameters.name, 'deletion', async () => {
        if (current.result) {
          await deleteFn(current.parameters, current.result.targetArn);
        }
      })
  };
};
