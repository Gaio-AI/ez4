import type { EntryStates } from '@ez4/state';

import { describe, it } from 'node:test';
import { deepEqual, equal } from 'node:assert/strict';

import { GetQueueUrlCommand, SQSClient } from '@aws-sdk/client-sqs';
import { createQueue, registerTriggers } from '@ez4/aws-queue';
import { deploy } from '@ez4/aws-common';

describe('queue import attributes', () => {
  registerTriggers();

  it('assert :: deploying an imported queue leaves the owner queue attributes alone', async (t) => {
    const send = t.mock.method(SQSClient.prototype, 'send', async (command: unknown) => {
      if (command instanceof GetQueueUrlCommand) {
        return { QueueUrl: `https://sqs.test/${command.input.QueueName}` };
      }

      return {};
    });

    const localState: EntryStates = {};

    createQueue(localState, undefined, {
      queueName: 'ez4-owner-queue',
      fifoMode: false,
      import: true
    });

    const { errors } = await deploy(localState, undefined);

    equal(errors.length, 0, errors.map((error) => error.message).join('\n'));

    const commands = send.mock.calls.map(({ arguments: [command] }) => (command as object).constructor.name);

    deepEqual(commands, ['GetQueueUrlCommand']);
  });
});
