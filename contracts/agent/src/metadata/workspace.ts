import type { ModelProperty, TypeClass } from '@ez4/reflection';
import { isModelProperty, isTypeObject, isTypeTuple } from '@ez4/reflection';
import { getPropertyObject, getPropertyString } from '@ez4/common/library';
import type { AgentService } from './types';
import { DuplicateWorkspaceRepoError, IncompleteServiceError, InvalidWorkspaceRepoError, InvalidWorkspaceRepoNameError } from '../errors/service';

const objectMembers = (property: ModelProperty): Record<string, ModelProperty> | undefined => {
  const object = getPropertyObject(property);
  if (!object || !Array.isArray(object.members) || !object.members.every(isModelProperty)) return undefined;
  return Object.fromEntries(object.members.map((member) => [member.name, member]));
};

export const getWorkspaceMetadata = (
  agentName: string,
  workspace: ModelProperty,
  declaration: TypeClass,
  errors: Error[]
): AgentService['workspace'] => {
  const invalid = (field: string) => errors.push(new IncompleteServiceError([`${agentName}.workspace.${field}`], declaration.file));
  const fields = objectMembers(workspace);
  if (!fields?.repos || !isTypeTuple(fields.repos.value)) {
    invalid('repos');
    return undefined;
  }

  const repos: NonNullable<AgentService['workspace']>['repos'] = [];
  const names = new Set<string>();
  for (const element of fields.repos.value.elements) {
    if (!isTypeObject(element) || !Array.isArray(element.members) || !element.members.every(isModelProperty)) {
      invalid('repos');
      continue;
    }
    const repo = Object.fromEntries(element.members.map((member) => [member.name, member]));
    const url = repo.url && getPropertyString(repo.url);
    const explicitName = repo.name && getPropertyString(repo.name);
    const explicitBranch = repo.branch && getPropertyString(repo.branch);
    if (url === undefined || (repo.name && explicitName === undefined) || (repo.branch && explicitBranch === undefined)) {
      invalid('repos');
      continue;
    }
    if (!/^https:\/\/[^/]+\/.+/.test(url)) {
      errors.push(new InvalidWorkspaceRepoError(agentName, url));
      continue;
    }
    const name =
      explicitName ??
      url
        .replace(/\/+$/, '')
        .split('/')
        .pop()!
        .replace(/\.git$/, '');
    if (!/^[A-Za-z0-9._-]+$/.test(name) || name === '.' || name === '..') {
      errors.push(new InvalidWorkspaceRepoNameError(agentName, name));
      continue;
    }
    if (names.has(name)) {
      errors.push(new DuplicateWorkspaceRepoError(agentName, name));
      continue;
    }
    names.add(name);
    repos.push({ url, name, branch: explicitBranch ?? 'main' });
  }

  let auth: NonNullable<AgentService['workspace']>['auth'];
  if (fields.auth) {
    const authFields = objectMembers(fields.auth);
    const githubApp = authFields?.githubApp && getPropertyString(authFields.githubApp);
    const token = authFields?.token && getPropertyString(authFields.token);
    if (!authFields || (githubApp === undefined) === (token === undefined) || Object.keys(authFields).length !== 1) {
      invalid('auth');
    } else {
      auth = githubApp !== undefined ? { githubApp } : { token: token! };
    }
  }

  return { repos, ...(auth && { auth }) };
};
