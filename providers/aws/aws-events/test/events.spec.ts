import type { FunctionState } from '@ez4/aws-function';
import type { EventsRuleState } from '../src/types';
import type { EventBridgeClient } from '@aws-sdk/client-eventbridge';
import type { LambdaClient } from '@aws-sdk/client-lambda';

import { describe, it } from 'node:test';
import { equal, ok, deepEqual } from 'node:assert/strict';

import { createEventsRule, createEventsRuleStateId } from '../src/service';
import { EventsRuleServiceType } from '../src/types';
import { getEventsRuleHandler } from '../src/handler';
import { putEventsRule, deleteEventsRule } from '../src/client';

describe('aws-events', () => {
  it('assert :: createEventsRule attaches state with dependency', () => {
    const states: Record<string, EventsRuleState> = {};
    const mockFunctionState = {
      entryId: 'fn-entry-1',
      type: 'aws:lambda.function',
      dependencies: [],
      parameters: {}
    } as unknown as FunctionState;

    const rule = createEventsRule(states, mockFunctionState, {
      name: 'test-rule',
      eventPattern: JSON.stringify({ source: ['aws.ecs'] })
    });

    equal(rule.type, EventsRuleServiceType);
    equal(rule.entryId, createEventsRuleStateId('test-rule'));
    deepEqual(rule.dependencies, ['fn-entry-1']);
    equal(rule.parameters.targetId, 'fn-entry-1');
    equal(rule.parameters.name, 'test-rule');
    ok(states[rule.entryId] !== undefined);
  });

  it('assert :: handler equals compares arn', () => {
    const handler = getEventsRuleHandler();
    const candidate: EventsRuleState = {
      type: EventsRuleServiceType,
      entryId: 'e1',
      dependencies: [],
      parameters: { name: 'r1', targetId: 't1' },
      result: { arn: 'arn:rule:1', targetArn: 'arn:fn:1' }
    };

    const same = { ...candidate };
    const diff = { ...candidate, result: { arn: 'arn:rule:2', targetArn: 'arn:fn:1' } };

    ok(handler.equals(candidate, same));
    ok(!handler.equals(candidate, diff));
  });

  it('assert :: putEventsRule issues putRule, addPermission, and putTargets', async () => {
    const sentEvents: unknown[] = [];
    const sentLambda: unknown[] = [];

    const fakeClients = {
      events: {
        send: async (cmd: unknown) => {
          sentEvents.push(cmd);
          return { RuleArn: 'arn:aws:events:us-east-1:123:rule/test-rule' };
        }
      } as unknown as EventBridgeClient,
      lambda: {
        send: async (cmd: unknown) => {
          sentLambda.push(cmd);
          return {};
        }
      } as unknown as LambdaClient
    };

    const result = await putEventsRule(
      { name: 'test-rule', targetId: 't1', eventPattern: '{"source":["test"]}' },
      'arn:aws:lambda:us-east-1:123:function:target',
      fakeClients
    );

    equal(result.arn, 'arn:aws:events:us-east-1:123:rule/test-rule');
    equal(result.targetArn, 'arn:aws:lambda:us-east-1:123:function:target');
    equal(sentEvents.length, 2);
    equal(sentLambda.length, 1);
  });

  it('assert :: deleteEventsRule removes targets, deletes rule, and removes permission', async () => {
    const sentEvents: unknown[] = [];
    const sentLambda: unknown[] = [];

    const fakeClients = {
      events: {
        send: async (cmd: unknown) => {
          sentEvents.push(cmd);
          return {};
        }
      } as unknown as EventBridgeClient,
      lambda: {
        send: async (cmd: unknown) => {
          sentLambda.push(cmd);
          return {};
        }
      } as unknown as LambdaClient
    };

    await deleteEventsRule({ name: 'test-rule', targetId: 't1' }, 'arn:aws:lambda:us-east-1:123:function:target', fakeClients);

    equal(sentEvents.length, 2);
    equal(sentLambda.length, 1);
  });
});
