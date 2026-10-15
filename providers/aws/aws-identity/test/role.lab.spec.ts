import type { EntryState, EntryStates } from '@ez4/state';

import { describe, it } from 'node:test';
import { ok, equal } from 'node:assert/strict';

import { DeleteRolePermissionsBoundaryCommand, GetRoleCommand, IAMClient } from '@aws-sdk/client-iam';
import { buildPolicyArn, createPolicy, createRole, getAccountId, isRoleState, registerTriggers } from '@ez4/aws-identity';
import { deploy } from '@ez4/aws-common';
import { deepClone } from '@ez4/utils';

import { getPolicyDocument } from './common/policy';
import { getRoleDocument } from './common/role';

const assertDeploy = async <E extends EntryState>(resourceId: string, newState: EntryStates<E>, oldState: EntryStates<E> | undefined) => {
  const { result: state } = await deploy(newState, oldState);

  const resource = state[resourceId];

  ok(resource?.result);
  ok(isRoleState(resource));

  const { roleName, roleArn, policyArns } = resource.result;

  ok(roleName);
  ok(roleArn);
  ok(policyArns);

  return {
    result: resource.result,
    state
  };
};

const getPermissionsBoundary = async (roleName: string) => {
  const response = await new IAMClient({}).send(new GetRoleCommand({ RoleName: roleName }));

  return response.Role?.PermissionsBoundary?.PermissionsBoundaryArn;
};

describe('role', { timeout: 60000 }, () => {
  let lastState: EntryStates | undefined;
  let roleId: string | undefined;

  registerTriggers();

  it('assert :: deploy', async () => {
    const localState: EntryStates = {};

    const policyResource = createPolicy(localState, {
      policyName: 'ez4-test-role-policy',
      policyDocument: getPolicyDocument()
    });

    // Deployed with the role, attached to nothing: a later step sets it as the role's boundary.
    createPolicy(localState, {
      policyName: 'ez4-test-role-boundary',
      policyDocument: getPolicyDocument()
    });

    const resource = createRole(localState, [policyResource], {
      roleName: 'ez4-test-role',
      roleDocument: getRoleDocument(),
      description: 'EZ4 Test role',
      tags: {
        test1: 'ez4-tag1',
        test2: 'ez4-tag2'
      }
    });

    roleId = resource.entryId;

    const { state } = await assertDeploy(roleId, localState, undefined);

    lastState = state;
  });

  it('assert :: update', async () => {
    ok(roleId && lastState);

    const localState = deepClone(lastState);
    const resource = localState[roleId];

    ok(resource && isRoleState(resource));

    resource.parameters.description = 'EZ4: Updated test role';

    resource.parameters.tags = {
      test2: 'ez4-tag2'
    };

    const { state } = await assertDeploy(roleId, localState, lastState);

    lastState = state;
  });

  it('assert :: update document', async () => {
    ok(roleId && lastState);

    const localState = deepClone(lastState);
    const resource = localState[roleId];

    ok(resource && isRoleState(resource));

    resource.parameters.roleDocument = getRoleDocument('UpdatedRoleDocument');

    const { state } = await assertDeploy(roleId, localState, lastState);

    lastState = state;
  });

  it('assert :: attach policy', async () => {
    ok(roleId && lastState);

    const localState = deepClone(lastState);
    const resource = localState[roleId];

    ok(resource && isRoleState(resource));

    const policyResource = createPolicy(localState, {
      policyName: 'ez4-test-role-new-policy',
      policyDocument: getPolicyDocument()
    });

    resource.dependencies.push(policyResource.entryId);

    const { state, result } = await assertDeploy(roleId, localState, lastState);

    equal(result.policyArns.length, 2);

    lastState = state;
  });

  it('assert :: detach policy', async () => {
    ok(roleId && lastState);

    const localState = deepClone(lastState);
    const resource = localState[roleId];

    ok(resource && isRoleState(resource));

    resource.dependencies.pop();

    const { state, result } = await assertDeploy(roleId, localState, lastState);

    equal(result.policyArns.length, 1);

    lastState = state;
  });

  it('assert :: update tags', async () => {
    ok(roleId && lastState);

    const localState = deepClone(lastState);
    const resource = localState[roleId];

    ok(resource && isRoleState(resource));

    resource.parameters.tags = {
      test2: 'ez4-tag2',
      test3: 'ez4-tag3'
    };

    const { state } = await assertDeploy(roleId, localState, lastState);

    lastState = state;
  });

  it('assert :: add permissions boundary', async () => {
    ok(roleId && lastState);

    const localState = deepClone(lastState);
    const resource = localState[roleId];

    ok(resource && isRoleState(resource));

    const boundaryArn = buildPolicyArn(await getAccountId(), 'ez4-test-role-boundary');

    resource.parameters.permissionsBoundary = boundaryArn;

    const { state, result } = await assertDeploy(roleId, localState, lastState);

    equal(await getPermissionsBoundary(result.roleName), boundaryArn);

    lastState = state;
  });

  it('assert :: keep permissions boundary without the option', async () => {
    ok(roleId && lastState);

    const localState = deepClone(lastState);
    const resource = localState[roleId];

    ok(resource && isRoleState(resource));

    const boundaryArn = resource.parameters.permissionsBoundary;

    delete resource.parameters.permissionsBoundary;

    const { state, result } = await assertDeploy(roleId, localState, lastState);

    equal(await getPermissionsBoundary(result.roleName), boundaryArn);

    // IAM refuses to delete a policy in use as a boundary, and the destroy deletes the boundary policy.
    await new IAMClient({}).send(new DeleteRolePermissionsBoundaryCommand({ RoleName: result.roleName }));

    lastState = state;
  });

  it('assert :: destroy', async () => {
    ok(roleId && lastState);

    ok(lastState[roleId]);

    const { result } = await deploy(undefined, lastState);

    equal(result[roleId], undefined);
  });
});
