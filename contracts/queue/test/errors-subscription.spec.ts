import { ok, equal, deepEqual } from 'assert/strict';
import { describe, it } from 'node:test';

import {
  IncompleteSubscriptionError,
  IncorrectSubscriptionTypeError,
  InvalidSubscriptionAcknowledgeError,
  InvalidSubscriptionBatchError,
  InvalidSubscriptionTypeError
} from '@ez4/queue/library';

import { InvalidServicePropertyError } from '@ez4/common/library';
import { registerTriggers } from '@ez4/queue/library';

import { parseFile } from './common/parser';

describe('queue subscription metadata errors', () => {
  registerTriggers();

  it('assert :: incomplete subscription', () => {
    const [error1] = parseFile('incomplete-subscription', 1);

    ok(error1 instanceof IncompleteSubscriptionError);
    deepEqual(error1.properties, ['handler']);
  });

  it('assert :: incorrect subscription', () => {
    const [error1] = parseFile('incorrect-subscription', 1);

    ok(error1 instanceof IncorrectSubscriptionTypeError);
    equal(error1.baseType, 'Queue.Subscription');
    equal(error1.subscriptionType, 'TestSubscription');
  });

  it('assert :: invalid subscription (declaration)', () => {
    const [error1] = parseFile('invalid-subscription-class', 1);

    ok(error1 instanceof InvalidSubscriptionTypeError);
    equal(error1.baseType, 'Queue.Subscription');
  });

  it('assert :: invalid subscription (property)', () => {
    const [error1] = parseFile('invalid-subscription-property', 1);

    ok(error1 instanceof InvalidServicePropertyError);
    deepEqual(error1.propertyName, 'invalid_property');
  });

  it('assert :: invalid subscription acknowledge', () => {
    const [error1] = parseFile('invalid-subscription-acknowledge', 1);

    ok(error1 instanceof InvalidSubscriptionAcknowledgeError);
    equal(error1.property, 'acknowledge');
    equal(error1.value, 'message');
  });

  it('assert :: invalid subscription batch (fifo queue)', () => {
    const [error1, error2] = parseFile('invalid-subscription-batch', 2);

    ok(error1 instanceof InvalidSubscriptionBatchError);
    equal(error1.handlerName, 'otherHandler');
    equal(error1.value, '11');

    ok(error2 instanceof InvalidSubscriptionBatchError);
    equal(error2.handlerName, 'testHandler');
    equal(error2.value, '11');
  });
});
