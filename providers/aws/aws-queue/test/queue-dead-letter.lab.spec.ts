import type { EntryState, EntryStates } from '@ez4/state';

import { describe, it } from 'node:test';
import { equal, ok } from 'node:assert/strict';

import { GetQueueAttributesCommand } from '@aws-sdk/client-sqs';
import { createQueue, isQueueState, registerTriggers } from '@ez4/aws-queue';
import { deploy } from '@ez4/aws-common';
import { deepClone } from '@ez4/utils';

import { getSQSClient } from '../src/utils/deploy';

const assertDeploy = async <E extends EntryState>(newState: EntryStates<E>, oldState: EntryStates<E> | undefined) => {
  const { result: state, errors } = await deploy(newState, oldState);

  equal(errors.length, 0, errors.map((error) => error.message).join('\n'));

  return state;
};

const getRedrivePolicy = async (queueUrl: string) => {
  const { Attributes } = await getSQSClient().send(
    new GetQueueAttributesCommand({
      QueueUrl: queueUrl,
      AttributeNames: ['RedrivePolicy']
    })
  );

  return Attributes?.RedrivePolicy;
};

describe('queue dead letter', { timeout: 90000 }, () => {
  let lastState: EntryStates | undefined;
  let queueId: string | undefined;

  registerTriggers();

  it('assert :: deploy with a dead letter', async () => {
    const localState: EntryStates = {};

    const deadLetterResource = createQueue(localState, undefined, {
      queueName: 'ez4-test-queue-dead-letter-target',
      fifoMode: false,
      timeout: 30,
      retention: 60
    });

    const resource = createQueue(localState, deadLetterResource, {
      queueName: 'ez4-test-queue-dead-letter',
      deadLetter: {
        maxAttempts: 3
      },
      fifoMode: false,
      timeout: 30,
      retention: 60
    });

    queueId = resource.entryId;
    lastState = await assertDeploy(localState, undefined);

    const queueState = lastState[queueId];

    ok(queueState && isQueueState(queueState) && queueState.result);
    ok(await getRedrivePolicy(queueState.result.queueUrl));
  });

  it('assert :: removing the dead letter removes the redrive policy', async () => {
    ok(queueId && lastState);

    const localState = deepClone(lastState);
    const resource = localState[queueId];

    ok(resource && isQueueState(resource));

    delete resource.parameters.deadLetter;

    lastState = await assertDeploy(localState, lastState);

    const queueState = lastState[queueId];

    ok(queueState && isQueueState(queueState) && queueState.result);
    equal(await getRedrivePolicy(queueState.result.queueUrl), undefined);
  });

  it('assert :: destroy', async () => {
    ok(queueId && lastState);

    const { result } = await deploy(undefined, lastState);

    equal(result[queueId], undefined);
  });
});
