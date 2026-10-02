import type { ProjectOptions, ProjectProxyOptions, ProjectServeOptions } from '../types/project';

import { toKebabCase } from '@ez4/utils';

import { getServiceBranch } from './resource';

export const getServicePort = (options?: ProjectServeOptions) => {
  return options?.localPort ?? 3734;
};

export const getServiceAddress = (options?: ProjectServeOptions) => {
  return options?.localHost ?? '0.0.0.0';
};

export const getProxyPort = (proxy?: ProjectProxyOptions) => {
  return Number(process.env.EZ4_PROXY_PORT) || proxy?.port || 80;
};

export const getServiceHost = (project: Pick<ProjectOptions, 'projectName' | 'branchName' | 'serveOptions'>, branch?: string) => {
  const { serveOptions } = project;

  if (!serveOptions?.proxy) {
    return `${serveOptions?.localHost ?? 'localhost'}:${getServicePort(serveOptions)}`;
  }

  const branchName = getServiceBranch(branch ?? project.branchName);
  const labels = [toKebabCase(project.projectName), branchName, toKebabCase(serveOptions.proxy.domain), 'localhost'];
  const hostname = labels.filter(Boolean).join('.');
  const port = getProxyPort(serveOptions.proxy);

  return port === 80 ? hostname : `${hostname}:${port}`;
};
