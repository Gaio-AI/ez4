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

export const getServeBind = (options?: ProjectServeOptions, env = process.env) => {
  if (!options?.proxy) {
    return { host: getServiceAddress(options), port: getServicePort(options), register: false };
  }

  return { host: '127.0.0.1', port: Number(env.PORT ?? 0), register: !env.EZ4_PROXY_ROUTE };
};

export const getServiceHost = (project: Pick<ProjectOptions, 'projectName' | 'branchName' | 'serveOptions'>, branch?: string) => {
  const { serveOptions } = project;

  if (!serveOptions?.proxy) {
    return `${serveOptions?.localHost ?? 'localhost'}:${getServicePort(serveOptions)}`;
  }

  const hostLabel = getServiceBranch(serveOptions.proxy.namespace ?? branch ?? project.branchName);
  const labels = [toKebabCase(project.projectName), hostLabel, toKebabCase(serveOptions.proxy.domain), 'localhost'];
  const hostname = labels.filter(Boolean).join('.');
  const port = getProxyPort(serveOptions.proxy);

  return port === 80 ? hostname : `${hostname}:${port}`;
};
