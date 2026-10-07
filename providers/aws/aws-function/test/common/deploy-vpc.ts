import type { EntryStates } from '@ez4/state';

import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { mock } from 'node:test';

import { GetFunctionCommand, LambdaClient, ResourceNotFoundException } from '@aws-sdk/client-lambda';
import { EC2Client } from '@aws-sdk/client-ec2';
import { createFunction, registerTriggers } from '@ez4/aws-function';
import { deploy, report } from '@ez4/aws-common';
import { ArchitectureType, RuntimeType } from '@ez4/project';
import { createLogGroup } from '@ez4/aws-logs';
import { createRole } from '@ez4/aws-identity';

type Network = {
  vpcId: string;
  subnets: { id: string; tags?: Record<string, string> }[];
  securityGroups: { id: string; name: string; tags?: Record<string, string> }[];
};

type Filter = {
  Name: string;
  Values: string[];
};

/**
 * One deploy of a project holding a single function in a VPC, in a process of its own: the network the
 * function resolves is looked up once per process, so two deploys are two processes.
 *
 * Lambda and EC2 are answered in place. EC2 describes the network in the network file and honors the
 * filters the provider sends (VPC, tag, group name); every Lambda command is recorded with the VPC
 * configuration it carried. The role and the log group start out deployed.
 *
 * usage (from the project folder): node deploy-vpc.ts <state file> <network file> <vpc: true|false> <report file>
 */
const [stateFile, networkFile, vpc, reportFile] = process.argv.slice(2);

const functionArn = 'arn:aws:lambda:us-east-1:000000000000:function:fixture-function';
const roleArn = 'arn:aws:iam::000000000000:role/fixture-role';
const groupArn = 'arn:aws:logs:us-east-1:000000000000:log-group:fixture-logs';

const network: Network = JSON.parse(await readFile(networkFile, 'utf8'));

const commands: { name: string; vpcConfig?: unknown }[] = [];

// Before the first deploy the function doesn't exist, so it is created rather than imported.
const isNewFunction = !existsSync(stateFile);

mock.method(LambdaClient.prototype, 'send', async (command: { input?: { VpcConfig?: unknown } }) => {
  if (isNewFunction && command instanceof GetFunctionCommand) {
    throw new ResourceNotFoundException({ message: 'Function not found.', $metadata: {} });
  }

  commands.push({ name: command.constructor.name, vpcConfig: command.input?.VpcConfig });

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

const matches = (filters: Filter[], resource: { vpcId: string; name?: string; tags?: Record<string, string> }) => {
  return filters.every(({ Name, Values }) => {
    if (Name === 'vpc-id') {
      return Values.includes(resource.vpcId);
    }

    if (Name === 'group-name') {
      return Values.includes(resource.name ?? '');
    }

    if (Name.startsWith('tag:')) {
      return Values.includes(resource.tags?.[Name.slice(4)] ?? '');
    }

    throw new Error(`Unexpected filter ${Name}.`);
  });
};

mock.method(EC2Client.prototype, 'send', async (command: { input: { Filters: Filter[] } }) => {
  const filters = command.input.Filters;

  switch (command.constructor.name) {
    case 'DescribeVpcsCommand':
      return { Vpcs: [{ VpcId: network.vpcId }] };

    case 'DescribeSubnetsCommand':
      return {
        Subnets: network.subnets
          .filter((subnet) => matches(filters, { ...subnet, vpcId: network.vpcId }))
          .map((subnet) => ({ SubnetId: subnet.id }))
      };

    case 'DescribeSecurityGroupsCommand':
      return {
        SecurityGroups: network.securityGroups
          .filter((group) => matches(filters, { ...group, vpcId: network.vpcId }))
          .map((group) => ({ GroupId: group.id }))
      };
  }

  throw new Error(`Unexpected EC2 command ${command.constructor.name}.`);
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
  sourceFile: 'handler.js',
  memory: 128,
  timeout: 5,
  vpc: vpc === 'true',
  getFunctionVariables: () => {
    return {};
  },
  getFunctionFiles: () => {
    return ['handler.js', ['handler.js']];
  },
  getFunctionBundle: () => {
    return 'handler.js';
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
