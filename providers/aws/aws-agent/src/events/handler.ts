import type { StepContext, StepHandler } from '@ez4/state';
import type { FunctionState } from '@ez4/aws-function';
import type { EventsRuleResult, EventsRuleState } from './types';
import { CorruptedResourceError, OperationLogger } from '@ez4/aws-common';
import { deepCompare } from '@ez4/utils';
import { putEventsRule, deleteEventsRule } from './client';
import { EventsRuleServiceName } from './types';

const getTargetArn = (candidate: EventsRuleState, context: StepContext): string => {
  const target = context.getDependencies<FunctionState>().find((entry) => entry.entryId === candidate.parameters.targetId);
  const arn = target?.result?.functionArn;
  if (!arn) throw new CorruptedResourceError(EventsRuleServiceName, candidate.parameters.name);
  return arn;
};

const createResource = (candidate: EventsRuleState, context: StepContext): Promise<EventsRuleResult> =>
  OperationLogger.logExecution(EventsRuleServiceName, candidate.parameters.name, 'creation', async () =>
    putEventsRule(candidate.parameters, getTargetArn(candidate, context))
  );

const replaceResource = (candidate: EventsRuleState, _current: EventsRuleState, context: StepContext): Promise<EventsRuleResult> =>
  createResource(candidate, context);

const updateResource = (candidate: EventsRuleState, current: EventsRuleState, context: StepContext): Promise<EventsRuleResult | void> => {
  const arn = getTargetArn(candidate, context);
  if (
    candidate.result?.targetArn === arn &&
    candidate.parameters.name === current.parameters.name &&
    candidate.parameters.eventPattern === current.parameters.eventPattern &&
    candidate.parameters.scheduleExpression === current.parameters.scheduleExpression
  )
    return Promise.resolve();
  return OperationLogger.logExecution(EventsRuleServiceName, candidate.parameters.name, 'updates', async () =>
    putEventsRule(candidate.parameters, arn)
  );
};

const deleteResource = (current: EventsRuleState): Promise<void> =>
  OperationLogger.logExecution(EventsRuleServiceName, current.parameters.name, 'deletion', async () => {
    if (current.result) await deleteEventsRule(current.parameters, current.result.targetArn);
  });

export const getEventsRuleHandler = (): StepHandler<EventsRuleState> => ({
  equals: (candidate, current) => candidate.result?.arn === current.result?.arn,
  preview: (candidate, current) => {
    const changes = deepCompare(candidate.parameters, current.parameters);
    return changes.counts ? { ...changes, name: candidate.parameters.name } : undefined;
  },
  create: createResource,
  replace: replaceResource,
  update: updateResource,
  delete: deleteResource
});
