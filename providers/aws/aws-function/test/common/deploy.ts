import type { EntryStates } from '@ez4/state';

import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { mock } from 'node:test';

import { LambdaClient } from '@aws-sdk/client-lambda';
import { createFunction, registerTriggers } from '@ez4/aws-function';
import { deploy, getFunctionBundle, report } from '@ez4/aws-common';
import { ArchitectureType, RuntimeType } from '@ez4/project';
import { createLogGroup } from '@ez4/aws-logs';
import { createRole } from '@ez4/aws-identity';

/**
 * One deploy of a project holding a single function, in a process of its own: the bundler and the
 * hashes cache what they read for the life of the process, so two deploys are two processes.
 *
 * Lambda is answered in place and every command the deploy sends is recorded, which is how the
 * caller tells an upload from a skip without reaching AWS. The role and the log group start out
 * deployed, so the function is the only resource that can change.
 *
 * usage (from the project folder, as a deploy runs): node deploy.ts <state file> <report file>
 */
const [stateFile, reportFile] = process.argv.slice(2);

const functionArn = 'arn:aws:lambda:us-east-1:000000000000:function:fixture-function';
const roleArn = 'arn:aws:iam::000000000000:role/fixture-role';
const groupArn = 'arn:aws:logs:us-east-1:000000000000:log-group:fixture-logs';

const commands: string[] = [];

mock.method(LambdaClient.prototype, 'send', async (command: object) => {
  commands.push(command.constructor.name);

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

registerTriggers();

const newState: EntryStates = {};

const roleState = createRole(newState, [], {
  roleName: 'fixture-role',
  roleDocument: {
    Version: '2012-10-17',
    Statement: []
  }
});

const logGroupState = createLogGroup(newState, {
  groupName: 'fixture-logs',
  retention: 1
});

const functionState = createFunction(newState, roleState, logGroupState, {
  runtime: RuntimeType.Node24,
  architecture: ArchitectureType.Arm,
  functionName: 'fixture-function',
  handlerName: 'main',
  sourceFile: 'handler.ts',
  memory: 128,
  timeout: 5,
  getFunctionVariables: () => {
    return {};
  },
  getFunctionFiles: () => {
    // What the TypeScript graph reaches: the handler, the template and the package's declarations.
    return ['handler.ts', ['handler.ts', 'template.ts', 'node_modules/fixture-lib/index.d.ts']];
  },
  getFunctionBundle: () => {
    return getFunctionBundle('fixture', {
      templateFile: 'template.ts',
      resourceName: 'fixture-function',
      filePrefix: 'fixture',
      handler: {
        sourceFile: 'handler.ts',
        functionName: 'main'
      }
    });
  },
  getFunctionHash: () => {
    return undefined;
  }
});

const getDeployedState = async (): Promise<EntryStates> => {
  if (existsSync(stateFile)) {
    return JSON.parse(await readFile(stateFile, 'utf8'));
  }

  return {
    [roleState.entryId]: {
      ...roleState,
      result: {
        roleName: 'fixture-role',
        policyArns: [],
        roleArn
      }
    },
    [logGroupState.entryId]: {
      ...logGroupState,
      result: {
        groupName: 'fixture-logs',
        groupArn
      }
    }
  };
};

const oldState = await getDeployedState();

for (const entryId in newState) {
  newState[entryId]!.result = oldState[entryId]?.result;
}

const steps = await report(newState, oldState);
const { result, errors } = await deploy(newState, oldState);

const functionStep = steps.find(({ entryId }) => entryId === functionState.entryId);

await writeFile(stateFile, JSON.stringify(result));

await writeFile(
  reportFile,
  JSON.stringify({
    action: functionStep?.action,
    changes: functionStep?.preview,
    result: result[functionState.entryId]?.result,
    errors: errors.map(({ message }) => message),
    commands
  })
);
