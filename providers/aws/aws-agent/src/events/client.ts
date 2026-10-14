import { EventBridgeClient, PutRuleCommand, PutTargetsCommand, RemoveTargetsCommand, DeleteRuleCommand } from '@aws-sdk/client-eventbridge';
import { LambdaClient, AddPermissionCommand, RemovePermissionCommand } from '@aws-sdk/client-lambda';
import type { EventsRuleParameters, EventsRuleResult } from './types';

export interface EventsClients {
  events: EventBridgeClient;
  lambda: LambdaClient;
}

const clients: EventsClients = { events: new EventBridgeClient(), lambda: new LambdaClient() };

export const putEventsRule = async (
  parameters: EventsRuleParameters,
  targetArn: string,
  client: EventsClients = clients
): Promise<EventsRuleResult> => {
  const { name, eventPattern, scheduleExpression } = parameters;
  const rule = await client.events.send(
    new PutRuleCommand({ Name: name, EventPattern: eventPattern, ScheduleExpression: scheduleExpression, State: 'ENABLED' })
  );
  if (!rule.RuleArn) throw new Error(`EventBridge rule ${name} returned no ARN`);
  try {
    await client.lambda.send(
      new AddPermissionCommand({
        FunctionName: targetArn,
        Action: 'lambda:InvokeFunction',
        Principal: 'events.amazonaws.com',
        SourceArn: rule.RuleArn,
        StatementId: name
      })
    );
  } catch (error: unknown) {
    if (!(error instanceof Error) || error.name !== 'ResourceConflictException') throw error;
  }
  await client.events.send(new PutTargetsCommand({ Rule: name, Targets: [{ Id: 'dispatcher', Arn: targetArn }] }));
  return { arn: rule.RuleArn, targetArn };
};

export const deleteEventsRule = async (
  parameters: EventsRuleParameters,
  targetArn: string,
  client: EventsClients = clients
): Promise<void> => {
  await client.events.send(new RemoveTargetsCommand({ Rule: parameters.name, Ids: ['dispatcher'] }));
  await client.events.send(new DeleteRuleCommand({ Name: parameters.name }));
  try {
    await client.lambda.send(new RemovePermissionCommand({ FunctionName: targetArn, StatementId: parameters.name }));
  } catch (error: unknown) {
    if (!(error instanceof Error) || error.name !== 'ResourceNotFoundException') throw error;
  }
};
