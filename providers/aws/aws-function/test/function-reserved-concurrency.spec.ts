import type { FunctionParameters } from '@ez4/aws-function';
import type { EntryStates } from '@ez4/state';

import { afterEach, describe, it, mock } from 'node:test';
import { deepEqual, equal, ok } from 'node:assert/strict';
import { join } from 'node:path';

import { GetFunctionCommand, LambdaClient, ResourceNotFoundException } from '@aws-sdk/client-lambda';
import { createFunction, registerTriggers } from '@ez4/aws-function';
import { deploy, report } from '@ez4/aws-common';
import { ArchitectureType, RuntimeType } from '@ez4/project';
import { createLogGroup } from '@ez4/aws-logs';
import { createRole } from '@ez4/aws-identity';

type Command = {
  name: string;
  input: Record<string, unknown>;
};

const functionName = 'ez4-test-reserved-concurrency';
const functionArn = `arn:aws:lambda:us-east-1:000000000000:function:${functionName}`;
const roleArn = 'arn:aws:iam::000000000000:role/ez4-test-role';
const groupArn = 'arn:aws:logs:us-east-1:000000000000:log-group:ez4-test-logs';

const sourceFile = join('test/files', 'lambda-1.js');

// Answers Lambda in place and keeps every command sent. `GetFunction` finds the function only when it
// already exists, which is what tells a creation from an import.
const mockLambda = (existing: boolean) => {
  const commands: Command[] = [];

  mock.method(LambdaClient.prototype, 'send', async (command: { input: Record<string, unknown> }) => {
    if (!existing && command instanceof GetFunctionCommand) {
      throw new ResourceNotFoundException({ message: 'Function not found.', $metadata: {} });
    }

    commands.push({ name: command.constructor.name, input: command.input });

    return {
      Configuration: {
        FunctionArn: functionArn
      },
      FunctionArn: functionArn,
      Version: `${commands.length}`,
      LastUpdateStatus: 'Successful',
      State: 'Active',
      Versions: []
    };
  });

  return commands;
};

// The state a deploy builds from the code, with the role and the log group already deployed.
const getState = (parameters: Partial<FunctionParameters>) => {
  const state: EntryStates = {};

  const roleState = createRole(state, [], {
    roleName: 'ez4-test-role',
    roleDocument: {
      Version: '2012-10-17',
      Statement: []
    }
  });

  const logGroupState = createLogGroup(state, {
    groupName: 'ez4-test-logs',
    retention: 1
  });

  const functionState = createFunction(state, roleState, logGroupState, {
    runtime: RuntimeType.Node24,
    architecture: ArchitectureType.Arm,
    functionName,
    handlerName: 'main',
    sourceFile,
    memory: 128,
    timeout: 5,
    getFunctionVariables: () => {
      return {};
    },
    getFunctionFiles: () => {
      return [sourceFile, [sourceFile]];
    },
    getFunctionBundle: () => {
      return sourceFile;
    },
    getFunctionHash: () => {
      return undefined;
    },
    ...parameters
  });

  roleState.result = {
    roleName: 'ez4-test-role',
    policyArns: [],
    roleArn
  };

  logGroupState.result = {
    groupArn
  };

  return {
    entryId: functionState.entryId,
    state
  };
};

// One deploy: the plan of the function and the commands it sent. Without a last state, the function
// isn't in the state yet: it's created, or imported when it already exists.
const deployFunction = async (parameters: Partial<FunctionParameters>, lastState?: EntryStates, existing = !!lastState) => {
  const { entryId, state: newState } = getState(parameters);

  const oldState = lastState ?? { ...newState };

  if (!lastState) {
    delete oldState[entryId];
  }

  for (const stateId in newState) {
    newState[stateId]!.result = oldState[stateId]?.result;
  }

  const commands = mockLambda(existing);

  const steps = await report(newState, oldState);
  const { result, errors } = await deploy(newState, oldState);

  deepEqual(
    errors.map(({ message }) => message),
    []
  );

  return {
    // The same round trip as the state file between two deploys.
    state: JSON.parse(JSON.stringify(result)) as EntryStates,
    preview: steps.find((step) => step.entryId === entryId)?.preview,
    concurrency: commands.filter(({ name }) => name.endsWith('FunctionConcurrencyCommand')),
    commands: commands.map(({ name }) => name)
  };
};

describe('function reserved concurrency', () => {
  registerTriggers();

  afterEach(() => {
    mock.restoreAll();
  });

  it('assert :: create reserves the concurrency', async () => {
    const { concurrency } = await deployFunction({ reservedConcurrency: 5 });

    deepEqual(concurrency, [
      {
        name: 'PutFunctionConcurrencyCommand',
        input: {
          FunctionName: functionName,
          ReservedConcurrentExecutions: 5
        }
      }
    ]);
  });

  it('assert :: create without it reserves nothing', async () => {
    const { concurrency } = await deployFunction({});

    deepEqual(concurrency, []);
  });

  it('assert :: import of an existing function reserves the concurrency', async () => {
    const { concurrency, commands } = await deployFunction({ reservedConcurrency: 5 }, undefined, true);

    ok(!commands.includes('CreateFunctionCommand'));

    deepEqual(concurrency, [
      {
        name: 'PutFunctionConcurrencyCommand',
        input: {
          FunctionName: functionName,
          ReservedConcurrentExecutions: 5
        }
      }
    ]);
  });

  it('assert :: update changes the reservation without a new version', async () => {
    const { state } = await deployFunction({ reservedConcurrency: 5 });

    const { preview, concurrency, commands } = await deployFunction({ reservedConcurrency: 10 }, state);

    deepEqual(preview?.update, { reservedConcurrency: 10 });

    deepEqual(concurrency, [
      {
        name: 'PutFunctionConcurrencyCommand',
        input: {
          FunctionName: functionName,
          ReservedConcurrentExecutions: 10
        }
      }
    ]);

    // The reservation belongs to the function, not to a version: nothing else changes.
    deepEqual(commands, ['PutFunctionConcurrencyCommand']);
  });

  it('assert :: taking the option out removes the reservation', async () => {
    const { state } = await deployFunction({ reservedConcurrency: 5 });

    const { preview, concurrency } = await deployFunction({}, state);

    deepEqual(preview?.remove, { reservedConcurrency: 5 });

    deepEqual(concurrency, [
      {
        name: 'DeleteFunctionConcurrencyCommand',
        input: {
          FunctionName: functionName
        }
      }
    ]);
  });

  it('assert :: the same reservation is no change', async () => {
    const { state } = await deployFunction({ reservedConcurrency: 5 });

    const { preview, commands } = await deployFunction({ reservedConcurrency: 5 }, state);

    equal(preview, undefined);
    deepEqual(commands, []);
  });

  it('assert :: update of a function that never declared it leaves the concurrency alone', async () => {
    const { state } = await deployFunction({});

    const { preview, concurrency } = await deployFunction({ memory: 256 }, state);

    deepEqual(preview?.update, { memory: 256 });
    deepEqual(concurrency, []);
  });
});
