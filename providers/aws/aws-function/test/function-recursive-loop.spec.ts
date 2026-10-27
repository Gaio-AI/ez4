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

const functionName = 'ez4-test-recursive-loop';
const functionArn = `arn:aws:lambda:us-east-1:000000000000:function:${functionName}`;
const roleArn = 'arn:aws:iam::000000000000:role/ez4-test-role';
const groupArn = 'arn:aws:logs:us-east-1:000000000000:log-group:ez4-test-logs';

const sourceFile = join('test/files', 'lambda-1.js');

// Answers Lambda in place and keeps every command sent. `GetFunction` finds the function only when it
// already exists, which is what tells a creation from an import.
const mockLambda = (existing: boolean) => {
  const commands: Command[] = [];

  mock.restoreAll();

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
    state: JSON.parse(JSON.stringify(result)) as EntryStates,
    preview: steps.find((step) => step.entryId === entryId)?.preview,
    recursion: commands.filter(({ name }) => name === 'PutFunctionRecursionConfigCommand').map(({ input }) => input),
    commands: commands.map(({ name }) => name)
  };
};

const allow = { FunctionName: functionName, RecursiveLoop: 'Allow' };
const terminate = { FunctionName: functionName, RecursiveLoop: 'Terminate' };

describe('function recursive loop', () => {
  registerTriggers();

  afterEach(() => {
    mock.restoreAll();
  });

  it('assert :: create allows the loop', async () => {
    const { recursion } = await deployFunction({ recursiveLoop: true });

    deepEqual(recursion, [allow]);
  });

  it('assert :: create without it leaves the detection alone', async () => {
    const { recursion } = await deployFunction({});

    deepEqual(recursion, []);
  });

  it('assert :: import of an existing function allows the loop', async () => {
    const { recursion, commands } = await deployFunction({ recursiveLoop: true }, undefined, true);

    ok(!commands.includes('CreateFunctionCommand'));

    deepEqual(recursion, [allow]);
  });

  it('assert :: turning it off puts the detection back without a new version', async () => {
    const { state } = await deployFunction({ recursiveLoop: true });

    const { preview, recursion, commands } = await deployFunction({ recursiveLoop: false }, state);

    deepEqual(preview?.update, { recursiveLoop: false });
    deepEqual(recursion, [terminate]);

    // The setting belongs to the function, not to a version: nothing else changes.
    deepEqual(commands, ['PutFunctionRecursionConfigCommand']);
  });

  it('assert :: taking the option out leaves the function as it is', async () => {
    const { state } = await deployFunction({ recursiveLoop: true });

    const { recursion } = await deployFunction({}, state);

    deepEqual(recursion, []);
  });

  it('assert :: the same setting is no change', async () => {
    const { state } = await deployFunction({ recursiveLoop: true });

    const { preview, commands } = await deployFunction({ recursiveLoop: true }, state);

    equal(preview, undefined);
    deepEqual(commands, []);
  });

  it('assert :: update of a function that never declared it leaves the detection alone', async () => {
    const { state } = await deployFunction({});

    const { preview, recursion } = await deployFunction({ memory: 256 }, state);

    deepEqual(preview?.update, { memory: 256 });
    deepEqual(recursion, []);
  });
});
