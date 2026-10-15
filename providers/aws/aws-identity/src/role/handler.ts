import type { StepContext, StepHandler } from '@ez4/state';
import type { Arn, OperationLogLine } from '@ez4/aws-common';
import type { PolicyState } from '../policy/types';
import type { RoleState, RoleResult, RoleParameters } from './types';

import { applyTagUpdates, OperationLogger, IncompleteResourceError, ReplaceResourceError, CorruptedResourceError } from '@ez4/aws-common';
import { deepCompare, deepEqual } from '@ez4/utils';

import {
  attachPolicy,
  createRole,
  deleteRole,
  detachPolicy,
  importRole,
  tagRole,
  untagRole,
  updateAssumeRole,
  putPermissionsBoundary,
  updateRole
} from './client';
import { PolicyServiceType } from '../policy/types';
import { RoleServiceName } from './types';

export const getRoleHandler = (): StepHandler<RoleState> => ({
  equals: equalsResource,
  create: createResource,
  replace: replaceResource,
  preview: previewResource,
  update: updateResource,
  delete: deleteResource
});

const equalsResource = (candidate: RoleState, current: RoleState) => {
  return !!candidate.result && candidate.result.roleArn === current.result?.roleArn;
};

const previewResource = (candidate: RoleState, current: RoleState) => {
  const target = { ...candidate.parameters, dependencies: candidate.dependencies };
  const source = { ...current.parameters, dependencies: current.dependencies };

  // A deploy without the option leaves the role's boundary as it is, so its absence is no change.
  if (!target.permissionsBoundary) {
    delete source.permissionsBoundary;
  }

  const changes = deepCompare(target, source);

  if (!changes.counts) {
    return undefined;
  }

  return {
    ...changes,
    name: target.roleName
  };
};

const replaceResource = async (candidate: RoleState, current: RoleState, context: StepContext) => {
  if (current.result) {
    throw new ReplaceResourceError(RoleServiceName, candidate.entryId, current.entryId);
  }

  return createResource(candidate, context);
};

const createResource = (candidate: RoleState, context: StepContext): Promise<RoleResult> => {
  const { parameters } = candidate;

  return OperationLogger.logExecution(RoleServiceName, parameters.roleName, 'creation', async (logger) => {
    const importedRole = await importRole(logger, parameters.roleName);
    const response = importedRole ?? (await createRole(logger, parameters));

    // A role that already exists keeps the boundary it has until set here, before any policy is attached.
    if (importedRole && parameters.permissionsBoundary && importedRole.permissionsBoundary !== parameters.permissionsBoundary) {
      await putPermissionsBoundary(logger, response.roleName, parameters.permissionsBoundary);
    }

    const policies = context.getDependencies<PolicyState>(PolicyServiceType);
    const policyArns = getPolicyArns(response.roleName, policies);

    if (policyArns.length) {
      await attachPolicies(logger, response.roleName, policyArns);
    }

    return {
      roleName: response.roleName,
      roleArn: response.roleArn,
      policyArns
    };
  });
};

const updateResource = (candidate: RoleState, current: RoleState, context: StepContext) => {
  const { result, parameters } = candidate;
  const { roleName } = parameters;

  return OperationLogger.logExecution(RoleServiceName, roleName, 'updates', async (logger) => {
    if (!result) {
      throw new CorruptedResourceError(RoleServiceName, roleName);
    }

    const policies = context.getDependencies<PolicyState>(PolicyServiceType);
    const policyArns = getPolicyArns(result.roleName, policies);

    await checkBoundaryUpdates(logger, result.roleName, candidate.parameters, current.parameters);
    await checkPolicyUpdates(logger, result.roleName, policyArns, result.policyArns);
    await checkDocumentUpdates(logger, result.roleName, candidate.parameters, current.parameters);
    await checkGeneralUpdates(logger, result.roleName, candidate.parameters, current.parameters);
    await checkTagUpdates(logger, result.roleName, candidate.parameters, current.parameters);

    return {
      ...result,
      policyArns
    };
  });
};

const deleteResource = async (current: RoleState) => {
  const { result, parameters } = current;

  if (result) {
    return OperationLogger.logExecution(RoleServiceName, parameters.roleName, 'deletion', async (logger) => {
      // Can only remove role after detaching all its policies.
      if (result.policyArns.length) {
        await detachPolicies(logger, result.roleName, result.policyArns);
      }

      await deleteRole(logger, result.roleName);
    });
  }
};

const getPolicyArns = (roleName: string, policyStates: PolicyState[]) => {
  return policyStates.map(({ parameters, result }) => {
    if (!result) {
      throw new IncompleteResourceError(RoleServiceName, roleName, parameters.policyName);
    }

    return result.policyArn;
  });
};

const checkGeneralUpdates = async (logger: OperationLogLine, roleName: string, candidate: RoleParameters, current: RoleParameters) => {
  if (candidate.description !== current.description) {
    await updateRole(logger, roleName, candidate.description);
  }
};

// Goes before the policy and trust updates: a deployer may be allowed to change a role only while it holds
// the boundary. Without the option the boundary stays: a deploy from code that predates the option would
// otherwise take it off, which is what a boundary is there to keep deployers from doing.
const checkBoundaryUpdates = async (logger: OperationLogLine, roleName: string, candidate: RoleParameters, current: RoleParameters) => {
  const { permissionsBoundary } = candidate;

  if (permissionsBoundary && permissionsBoundary !== current.permissionsBoundary) {
    await putPermissionsBoundary(logger, roleName, permissionsBoundary);
  }
};

const checkDocumentUpdates = async (logger: OperationLogLine, roleName: string, candidate: RoleParameters, current: RoleParameters) => {
  const hasChanges = !deepEqual(candidate.roleDocument, current.roleDocument);

  if (hasChanges) {
    await updateAssumeRole(logger, roleName, candidate.roleDocument);
  }
};

const checkPolicyUpdates = async (logger: OperationLogLine, roleName: string, newPolicyArns: Arn[], oldPolicyArns: Arn[]) => {
  const newPolicyArnSet = new Set(newPolicyArns);
  const oldPolicyArnSet = new Set(oldPolicyArns);

  const policiesToAttach = newPolicyArns.filter((policyArn) => !oldPolicyArnSet.has(policyArn));
  const policiesToDetach = oldPolicyArns.filter((policyArn) => !newPolicyArnSet.has(policyArn));

  await attachPolicies(logger, roleName, policiesToAttach);
  await detachPolicies(logger, roleName, policiesToDetach);

  return newPolicyArns;
};

const checkTagUpdates = async (logger: OperationLogLine, roleName: string, candidate: RoleParameters, current: RoleParameters) => {
  await applyTagUpdates(
    candidate.tags,
    current.tags,
    (tags) => tagRole(logger, roleName, tags),
    (tags) => untagRole(logger, roleName, tags)
  );
};

const attachPolicies = async (logger: OperationLogLine, roleName: string, policyArns: Arn[]) => {
  const operations = policyArns.map(async (policyArn) => {
    await attachPolicy(logger, roleName, policyArn);

    return policyArn;
  });

  return Promise.all(operations);
};

const detachPolicies = async (logger: OperationLogLine, roleName: string, policyArns: Arn[]) => {
  const operations = policyArns.map(async (policyArn) => {
    await detachPolicy(logger, roleName, policyArn);

    return policyArn;
  });

  return Promise.all(operations);
};
