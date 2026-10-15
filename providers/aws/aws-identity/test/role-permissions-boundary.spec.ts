import type { RoleParameters } from '@ez4/aws-identity';
import type { EntryStates } from '@ez4/state';

import { afterEach, describe, it, mock } from 'node:test';
import { deepEqual, equal } from 'node:assert/strict';

import { GetRoleCommand, IAMClient, NoSuchEntityException } from '@aws-sdk/client-iam';
import { createPolicy, createRole, registerTriggers } from '@ez4/aws-identity';
import { deploy, report } from '@ez4/aws-common';

import { getPolicyDocument } from './common/policy';
import { getRoleDocument } from './common/role';

type Command = {
  name: string;
  input: Record<string, unknown>;
};

const roleName = 'ez4-test-boundary-role';
const roleArn = `arn:aws:iam::000000000000:role/${roleName}`;
const policyArn = 'arn:aws:iam::000000000000:policy/ez4-test-boundary-role-policy';

const boundaryArn = 'arn:aws:iam::000000000000:policy/ez4-test-boundary';
const otherBoundaryArn = 'arn:aws:iam::000000000000:policy/ez4-test-other-boundary';

// Answers IAM in place and keeps every command sent. `GetRole` finds the role only when it already exists,
// with the boundary it holds, which is what tells a creation from an import.
const mockIAM = (existing: { boundary?: string } | undefined) => {
  const commands: Command[] = [];

  // A test that deploys twice mocks twice, and `restoreAll` would put the first mock back over the real
  // method, leaving it for the specs that run next in the same process.
  mock.restoreAll();

  mock.method(IAMClient.prototype, 'send', async (command: { input: Record<string, unknown> }) => {
    if (command instanceof GetRoleCommand) {
      if (!existing) {
        throw new NoSuchEntityException({ message: 'Role not found.', $metadata: {} });
      }

      return {
        Role: {
          Arn: roleArn,
          PermissionsBoundary: existing.boundary && { PermissionsBoundaryArn: existing.boundary }
        }
      };
    }

    commands.push({ name: command.constructor.name, input: command.input });

    return {
      Role: {
        Arn: roleArn
      }
    };
  });

  return commands;
};

// The state a deploy builds from the code, with the role's policy already deployed.
const getState = (parameters: Partial<RoleParameters>) => {
  const state: EntryStates = {};

  const policyState = createPolicy(state, {
    policyName: 'ez4-test-boundary-role-policy',
    policyDocument: getPolicyDocument()
  });

  const roleState = createRole(state, [policyState], {
    roleName,
    roleDocument: getRoleDocument(),
    ...parameters
  });

  policyState.result = {
    versionHistory: [],
    currentVersion: 'v1',
    policyArn
  };

  return {
    entryId: roleState.entryId,
    state
  };
};

// One deploy: the plan of the role and the commands it sent. Without a last state, the role isn't in the
// state yet: it's created, or imported when it already exists.
const deployRole = async (parameters: Partial<RoleParameters>, lastState?: EntryStates, existing?: { boundary?: string }) => {
  const { entryId, state: newState } = getState(parameters);

  const oldState = lastState ?? { ...newState };

  if (!lastState) {
    delete oldState[entryId];
  }

  for (const stateId in newState) {
    newState[stateId]!.result = oldState[stateId]?.result;
  }

  const commands = mockIAM(lastState ? {} : existing);

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
    commands
  };
};

const getNames = (commands: Command[]) => {
  return commands.map(({ name }) => name);
};

describe('role permissions boundary', () => {
  registerTriggers();

  afterEach(() => {
    mock.restoreAll();
  });

  it('assert :: create with a boundary', async () => {
    const { commands } = await deployRole({ permissionsBoundary: boundaryArn });

    deepEqual(getNames(commands), ['CreateRoleCommand', 'AttachRolePolicyCommand']);
    equal(commands[0]!.input.PermissionsBoundary, boundaryArn);
  });

  it('assert :: create without a boundary', async () => {
    const { commands } = await deployRole({});

    deepEqual(getNames(commands), ['CreateRoleCommand', 'AttachRolePolicyCommand']);
    equal(commands[0]!.input.PermissionsBoundary, undefined);
  });

  it('assert :: import a role without the boundary', async () => {
    const { commands } = await deployRole({ permissionsBoundary: boundaryArn }, undefined, {});

    deepEqual(getNames(commands), ['PutRolePermissionsBoundaryCommand', 'AttachRolePolicyCommand']);
    equal(commands[0]!.input.PermissionsBoundary, boundaryArn);
  });

  it('assert :: import a role that holds the boundary', async () => {
    const { commands } = await deployRole({ permissionsBoundary: boundaryArn }, undefined, { boundary: boundaryArn });

    deepEqual(getNames(commands), ['AttachRolePolicyCommand']);
  });

  it('assert :: add the boundary to a deployed role', async () => {
    const { state } = await deployRole({});

    const { preview, commands } = await deployRole({ permissionsBoundary: boundaryArn, roleDocument: getRoleDocument('Updated') }, state);

    equal(preview?.counts, 2);

    // Before the trust update, which a deployer may be allowed only on a role that holds the boundary.
    deepEqual(getNames(commands), ['PutRolePermissionsBoundaryCommand', 'UpdateAssumeRolePolicyCommand']);
    equal(commands[0]!.input.PermissionsBoundary, boundaryArn);
  });

  it('assert :: replace the boundary', async () => {
    const { state } = await deployRole({ permissionsBoundary: boundaryArn });

    const { commands } = await deployRole({ permissionsBoundary: otherBoundaryArn }, state);

    deepEqual(getNames(commands), ['PutRolePermissionsBoundaryCommand']);
    equal(commands[0]!.input.PermissionsBoundary, otherBoundaryArn);
  });

  it('assert :: no boundary option leaves the boundary', async () => {
    const { state } = await deployRole({ permissionsBoundary: boundaryArn });

    const { preview, commands } = await deployRole({}, state);

    equal(preview, undefined);
    deepEqual(getNames(commands), []);
  });

  it('assert :: no boundary option leaves the boundary of an imported role', async () => {
    const { commands } = await deployRole({}, undefined, { boundary: boundaryArn });

    deepEqual(getNames(commands), ['AttachRolePolicyCommand']);
  });

  // Deploys from code with and without the option, one after the other, don't flap the role.
  it('assert :: the option back after a deploy without it plans nothing', async () => {
    const { state: withBoundary } = await deployRole({ permissionsBoundary: boundaryArn });
    const { state } = await deployRole({}, withBoundary);

    const { preview, commands } = await deployRole({ permissionsBoundary: boundaryArn }, state);

    equal(preview, undefined);
    deepEqual(getNames(commands), []);
  });

  it('assert :: unchanged boundary plans nothing', async () => {
    const { state } = await deployRole({ permissionsBoundary: boundaryArn });

    const { preview, commands } = await deployRole({ permissionsBoundary: boundaryArn }, state);

    equal(preview, undefined);
    deepEqual(getNames(commands), []);
  });

  it('assert :: no boundary option plans nothing', async () => {
    const { state } = await deployRole({});

    const { preview, commands } = await deployRole({}, state);

    equal(preview, undefined);
    deepEqual(getNames(commands), []);
  });
});
